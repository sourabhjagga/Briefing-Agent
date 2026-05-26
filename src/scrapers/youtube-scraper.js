/**
 * YouTube Scraper
 * Pure HTTP scraper (Puppeteer-free).
 * Monitors channel RSS feeds, downloads captions directly, and summarizes via the central Summarizer.
 */

const axios = require('axios');
const { YoutubeTranscript } = require('youtube-transcript');
const logger = require('../logger');

class YoutubeScraper {
  constructor(database, summarizer) {
    this.database = database;
    this.summarizer = summarizer;
    this.checkInterval = 60 * 60 * 1000; // Hourly check
    this.intervalId = null;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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
        
        let summary = '';
        try {
          const transcript = await this.fetchTranscript(video.id);
          if (transcript && transcript.length > 100) {
            summary = await this.summarizer.summarizeYoutubeVideo(video.title, transcript, source.type);
          } else {
            logger.warn(`⚠️ Transcript for video ${video.id} too short/empty. Summarizing using title only.`);
            summary = await this.summarizer.summarizeYoutubeVideo(video.title, '[No transcript available]', source.type);
          }
        } catch (err) {
          logger.error(`Error fetching/summarizing transcript for video ${video.id}: ${err.message}`);
          summary = `(Transcript unavailable due to error: ${err.message})\nThis video covers: "${video.title}"`;
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
      headers: { 'User-Agent': this.userAgent },
      timeout: 15000
    });

    const html = res.data;
    const match = html.match(/<meta[^>]*itemprop="channelId"[^>]*content="([^"]+)"/);
    if (match) return match[1];

    const match2 = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
    if (match2) return match2[1];

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
    try {
      // 1. Try fetching Hindi transcript first
      let tracks;
      try {
        tracks = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'hi' });
      } catch (err) {
        logger.debug(`No direct Hindi transcript found for ${videoId}, trying English fallback...`);
        // 2. Try fetching English transcript
        try {
          tracks = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        } catch (enErr) {
          logger.debug(`No direct English transcript found for ${videoId}, trying default track...`);
          // 3. Fallback to default track
          tracks = await YoutubeTranscript.fetchTranscript(videoId);
        }
      }

      if (!tracks || tracks.length === 0) return '';
      
      return tracks.map(t => t.text)
        .join(' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    } catch (err) {
      logger.warn(`Failed to fetch YouTube transcript: ${err.message}`);
      return '';
    }
  }
}

module.exports = YoutubeScraper;
