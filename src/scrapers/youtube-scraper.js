/**
 * YouTube Scraper
 * Pure HTTP scraper (Puppeteer-free).
 * Monitors channel RSS feeds, downloads captions directly, and summarizes via the central Summarizer.
 * 
 * FAILPROOF NATIVE GEMINI AUDIO FALLBACK:
 * - If standard auto-captions/transcripts are disabled or missing,
 *   downloads the raw audio stream in low-quality format using @distube/ytdl-core.
 * - Sends the audio buffer directly to Gemini 3.1 Flash Lite for ultra-accurate speech-to-text.
 * - Automatically cleans up temporary files immediately to preserve zero disk footprint.
 */

const axios = require('axios');
const { YoutubeTranscript } = require('youtube-transcript');
const ytdl = require('@distube/ytdl-core');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class YoutubeScraper {
  constructor(database, summarizer) {
    this.database = database;
    this.summarizer = summarizer;
    this.checkInterval = 60 * 60 * 1000; // Hourly check
    this.intervalId = null;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    // Initialize standard Gemini client for audio transcription using process.env.GEMINI_API_KEY
    this.geminiKey = process.env.GEMINI_API_KEY || '';
    this.genAI = this.geminiKey ? new GoogleGenerativeAI(this.geminiKey) : null;
  }

  start() {
    logger.info('🚀 Youtube HTTP Scraper initialized (monitors channels hourly)...');
    this.scrapeAll();
    this.intervalId = setInterval(() => this.scrapeAll(), this.checkInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async scrapeAll() {
    logger.info('🔄 Running YouTube channel scraper session...');
    try {
      const allSources = this.database.getAllSources();
      const activeYoutube = allSources.filter(s => s.is_active === 1 && (s.type === 'cc-youtube' || s.type === 'deals-youtube'));

      for (const source of activeYoutube) {
        await this.scrapeChannel(source);
      }
    } catch (err) {
      logger.error(`Error in scrapeAll YouTube: ${err.message}`);
    }
  }

  async scrapeChannel(source) {
    try {
      let channelId = source.source_id.trim();

      // Resolve handles/URLs dynamically via Axios
      if (!channelId.startsWith('UC') || channelId.length !== 24) {
        logger.info(`🔍 Resolving YouTube channel handle/URL for: "${source.name}" (${channelId})`);
        try {
          channelId = await this.resolveChannelId(channelId);
          // Update database cache
          this.database.db.prepare('UPDATE sources SET source_id = ? WHERE id = ?').run(channelId, source.id);
          logger.info(`✅ Resolved "${source.name}" to channel ID: ${channelId}`);
        } catch (resolveErr) {
          logger.error(`❌ Failed to resolve handle "${channelId}" for "${source.name}": ${resolveErr.message}`);
          return;
        }
      }

      logger.info(`📡 Scraping YouTube RSS feed for: "${source.name}" (ID: ${channelId})`);
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': this.userAgent },
        timeout: 15000
      });

      const videos = this.parseFeedXml(res.data);
      if (videos.length === 0) {
        logger.info(`ℹ️ No videos found in RSS feed for ${source.name}.`);
        return;
      }

      // Process latest 3 videos
      const latestVideos = videos.slice(0, 3);
      for (const video of latestVideos) {
        const dbId = `yt_${video.id}`;
        
        // Check if already processed
        const exists = this.database.db.prepare('SELECT 1 FROM messages WHERE message_id = ?').get(dbId);
        if (exists) continue;

        logger.info(`🎥 Processing new video: "${video.title}" (ID: ${video.id}) from "${source.name}"`);
        
        let transcript = '';
        let summary = '';

        // Step 1: Try fetching standard subtitles/transcript
        try {
          transcript = await this.fetchTranscript(video.id);
        } catch (err) {
          logger.warn(`Subtitles disabled or unavailable for video ${video.id}.`);
        }

        // Step 2: Gemini Audio Fallback if standard subtitles failed or returned empty
        if (!transcript || transcript.length < 100) {
          logger.info(`🎙️ Triggering Gemini Audio Fallback for video ${video.id}...`);
          try {
            transcript = await this.transcribeAudioWithGemini(video.id);
          } catch (audioErr) {
            logger.error(`❌ Gemini Audio Fallback failed for video ${video.id}: ${audioErr.message}`);
          }
        }

        // Step 3: Summarize via unified pipeline
        try {
          if (transcript && transcript.length > 50) {
            summary = await this.summarizer.summarizeYoutubeVideo(video.title, transcript, source.type);
          } else {
            logger.warn(`⚠️ Transcript empty. Summarizing using title only.`);
            summary = await this.summarizer.summarizeYoutubeVideo(video.title, '[No transcript available]', source.type);
          }
        } catch (sumErr) {
          logger.error(`Error summarizing video ${video.id}: ${sumErr.message}`);
          summary = `(Transcript unavailable)\nThis video covers: "${video.title}"`;
        }

        this.database.saveMessage({
          messageId: dbId,
          groupName: source.name,
          groupId: `yt_channel_${channelId}`,
          chatType: 'channel',
          senderName: source.name,
          senderNumber: '',
          body: `🎥 <b>YouTube Video Summary</b>\n📌 <b>Title:</b> ${video.title}\n\n${summary}\n\n🔗 <b>Watch:</b> https://youtu.be/${video.id}`,
          timestamp: Math.floor(video.published.getTime() / 1000),
          hasMedia: false,
          mediaCaption: '',
          isForwarded: false,
          sourceType: source.type
        });

        logger.info(`✅ Successfully processed video summary for "${video.title}"`);
      }
    } catch (err) {
      logger.error(`Error scraping channel ${source.name}: ${err.message}`);
    }
  }

  /**
   * FAILSFEAF AUDIO TRANSCRIPTION:
   * - Downloads lowest-bitrate mono audio directly to a buffer.
   * - Instructs Gemini 3.1 Flash Lite to perform ultra-accurate speech-to-text.
   */
  async transcribeAudioWithGemini(videoId) {
    if (!this.genAI) {
      throw new Error('Gemini API key is not configured.');
    }

    const tempDir = path.resolve(__dirname, '../../data/temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const outputPath = path.join(tempDir, `${videoId}.mp3`);

    let ytdlAgent = null;
    const cookiePath = path.resolve(__dirname, '../../data/youtube_cookies.txt');
    if (fs.existsSync(cookiePath)) {
      try {
        const raw = fs.readFileSync(cookiePath, 'utf8');
        const lines = raw.split('\n');
        const cookieArray = [];
        for (const line of lines) {
          if (!line || line.startsWith('#')) continue;
          const parts = line.split('\t');
          if (parts.length >= 7) {
            cookieArray.push({
              domain: parts[0].trim(),
              path: parts[2].trim(),
              secure: parts[3].trim().toUpperCase() === 'TRUE',
              name: parts[5].trim(),
              value: parts[6].trim()
            });
          }
        }
        if (cookieArray.length > 0) {
          ytdlAgent = ytdl.createAgent(cookieArray);
          logger.info(`🍪 Parsed ${cookieArray.length} authenticated cookies and created ytdl agent.`);
        }
      } catch (err) {
        logger.error(`Failed to parse youtube_cookies.txt: ${err.message}`);
      }
    }

    try {
      logger.info(`📥 Downloading raw low-quality audio for video ${videoId} with authenticated ytdl agent...`);
      await new Promise((resolve, reject) => {
        const downloadOptions = {
          filter: 'audioonly',
          quality: 'lowestaudio'
        };

        if (ytdlAgent) {
          downloadOptions.agent = ytdlAgent;
        }

        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, downloadOptions);
        
        // CRITICAL: Catch errors directly on the ytdl stream to prevent process crash
        stream.on('error', (err) => {
          reject(err);
        });

        const fileStream = fs.createWriteStream(outputPath);
        fileStream.on('finish', () => resolve());
        fileStream.on('error', (err) => reject(err));

        stream.pipe(fileStream);
      });

      const audioBytes = fs.readFileSync(outputPath);
      logger.info(`🎙️ Uploading audio payload (~${Math.round(audioBytes.length / 1024)} KB) directly to Gemini 3.1 Flash Lite...`);

      // Construct native inline multimodal part
      const audioPart = {
        inlineData: {
          data: audioBytes.toString('base64'),
          mimeType: 'audio/mp3'
        }
      };

      const model = this.genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
      const prompt = 'Transcribe this audio accurately. Write it in the original language (Hindi/English). Provide a clean, readable text output.';

      const result = await model.generateContent([prompt, audioPart]);
      const transcript = result.response.text();
      
      logger.info(`✅ Gemini Audio transcription completed (~${transcript.length} chars generated)`);
      return transcript;
    } catch (ytdlErr) {
      logger.warn(`⚠️ YouTube audio stream download blocked: ${ytdlErr.message}. Cascading to Layer 3: Google Search Grounding...`);
      
      try {
        const model = this.genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          tools: [{ googleSearch: {} }]
        });
        
        const prompt = `Search Google for transcripts, details, articles, or summaries of the YouTube video: https://youtu.be/${videoId}.
Reconstruct a detailed outline of this video's contents, focusing specifically on credit cards, hacks, strategic tricks, savings, or shopping offers discussed.
Provide a complete, long text explanation (~500 words) of the video content.`;

        const result = await model.generateContent(prompt);
        const searchOutput = result.response.text();
        
        logger.info(`✅ Google Search Grounding retrieved outline successfully (~${searchOutput.length} chars generated)`);
        return searchOutput;
      } catch (groundingErr) {
        logger.error(`❌ Google Search Grounding failed: ${groundingErr.message}`);
        throw new Error(`Both Audio Download and Google Search Grounding failed: ${groundingErr.message}`);
      }
    } finally {
      // Always cleanup temporary audio file to maintain zero host footprint
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
          logger.debug(`🧹 Cleaned up temporary audio file: ${outputPath}`);
        } catch (e) {
          logger.debug(`Could not clean up temporary file ${outputPath}: ${e.message}`);
        }
      }
    }
  }

  async resolveChannelId(input) {
    let cleanUrl = input.trim();
    if (!cleanUrl.startsWith('http')) {
      if (cleanUrl.startsWith('@')) {
        cleanUrl = `https://www.youtube.com/${cleanUrl}`;
      } else {
        cleanUrl = `https://www.youtube.com/@${cleanUrl}`;
      }
    }

    logger.debug(`Resolving YouTube channel via HTTP: ${cleanUrl}`);
    const res = await axios.get(cleanUrl, {
      headers: { 
        'User-Agent': this.userAgent,
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });

    const html = res.data;
    
    // Pattern 1: standard metadata itemprop
    const match = html.match(/<meta[^>]*itemprop="channelId"[^>]*content="([^"]+)"/);
    if (match) return match[1];

    // Pattern 2: direct JSON config channelId value
    const match2 = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
    if (match2) return match2[1];

    // Pattern 3: ytInitialData navigationEndpoint payload
    const match3 = html.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/);
    if (match3) return match3[1];

    // Pattern 4: RSS link href resolution
    const match4 = html.match(/href="https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]{22})"/);
    if (match4) return match4[1];

    throw new Error('Could not discover Channel ID inside the YouTube page HTML structure.');
  }

  parseFeedXml(xml) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    const videos = [];
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);

      if (videoIdMatch && titleMatch) {
        videos.push({
          id: videoIdMatch[1],
          title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          published: publishedMatch ? new Date(publishedMatch[1]) : new Date()
        });
      }
    }
    return videos;
  }

  async fetchTranscript(videoId) {
    logger.debug(`Fetching transcript directly via youtube-transcript API for: ${videoId}`);
    // Explicitly throw standard exceptions so the outer block cascades to Gemini fallback
    const tracks = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'hi' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }))
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));

    if (!tracks || tracks.length === 0) return '';
    
    return tracks.map(t => t.text)
      .join(' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}

module.exports = YoutubeScraper;
