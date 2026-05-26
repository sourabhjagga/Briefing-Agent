/**
 * Reddit Scraper
 * Pure HTTP scraper utilizing Axios and Cheerio (Puppeteer-free).
 * Implements a robust 3-layer fallback ingestion strategy to bypass cloud IP blocks.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class RedditScraper {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.cookiePath = path.resolve(__dirname, '../../data/reddit_cookies.json');
    this.checkInterval = 15 * 60 * 1000; // 15 minutes
    
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    this.cookiesHeader = '';
    this.isSessionAlerted = false;
  }

  async start() {
    logger.info('🚀 Reddit HTTP scraper initialized (scrapes subreddits every 15 min)...');
    try {
      await this.scrape();
      this.intervalId = setInterval(() => this.scrape(), this.checkInterval);
    } catch (err) {
      logger.error(`Reddit Scraper startup failed: ${err.message}`);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async scrape() {
    const allSources = this.database.getAllSources();
    const activeReddit = allSources.filter(s => s.is_active === 1 && (s.type === 'cc-reddit' || s.type === 'deals-reddit'));
    if (activeReddit.length === 0) return;

    logger.info(`🔍 Starting Reddit scrape session for ${activeReddit.length} subreddits...`);
    
    // Load and check imported session cookies if present
    this._loadCookies();

    for (const source of activeReddit) {
      const sub = this._cleanRedditId(source.source_id);
      if (!sub) continue;

      let success = await this._scrapeViaJSON(sub, source.type, source.name);
      if (!success) {
        success = await this._scrapeViaCookies(sub, source.type, source.name);
      }
      if (!success) {
        success = await this._scrapeViaRSS(sub, source.type, source.name);
      }

      if (!success) {
        logger.error(`❌ All Reddit ingestion layers failed for r/${sub}`);
      }

      // Random delay to avoid hitting Reddit's rate limit
      const delay = Math.floor(Math.random() * 5000) + 3000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  _loadCookies() {
    if (fs.existsSync(this.cookiePath)) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        const cookiesArray = JSON.parse(raw);
        this.cookiesHeader = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');
      } catch (err) {
        logger.error(`Failed to load Reddit cookies: ${err.message}`);
      }
    } else {
      this.cookiesHeader = '';
    }
  }

  // --- LAYER 1: Reddit Public JSON API ---
  async _scrapeViaJSON(sub, sourceType, sourceName) {
    logger.debug(`Reddit Layer 1: Attempting public JSON API for r/${sub}`);
    try {
      const res = await axios.get(`https://www.reddit.com/r/${sub}/new.json?limit=15`, {
        headers: {
          'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 cc-brief-agent-v1`,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      if (res.data && res.data.data && res.data.data.children) {
        const posts = res.data.data.children.map(child => child.data);
        await this._saveRedditPosts(posts, sub, sourceType, sourceName);
        logger.info(`✅ Reddit Layer 1: Ingested ${posts.length} posts from r/${sub}`);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`Reddit Layer 1 failed for r/${sub}: ${err.message}`);
      return false;
    }
  }

  // --- LAYER 2: Reddit Authenticated Cookies Scrape ---
  async _scrapeViaCookies(sub, sourceType, sourceName) {
    if (!this.cookiesHeader) {
      logger.debug('Reddit Layer 2: Skipping, no session cookies active.');
      return false;
    }

    logger.debug(`Reddit Layer 2: Attempting authenticated HTTP scraper for r/${sub}`);
    try {
      // 1. Validate if cookies are active
      const isSessionActive = await this._verifyRedditSession();
      if (!isSessionActive) {
        if (!this.isSessionAlerted && this.onAlert) {
          if (typeof this.onAlert === 'function') {
            this.onAlert(
              '⚠️ <b>Reddit Session Expired</b>\n\nYour Reddit scraper session cookies have expired or are invalid. Please login to Reddit in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard to resume authenticated scraping.'
            );
          } else if (typeof this.onAlert.sendMessage === 'function') {
            await this.onAlert.sendMessage(
              '⚠️ <b>Reddit Session Expired</b>\n\nYour Reddit scraper session cookies have expired or are invalid. Please login to Reddit in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard to resume authenticated scraping.'
            ).catch(() => {});
          }
          this.isSessionAlerted = true;
        }
        return false;
      }
      this.isSessionAlerted = false; // Reset alert status on successful session

      // 2. Fetch target HTML page using session cookies
      const res = await axios.get(`https://www.reddit.com/r/${sub}/new/`, {
        headers: {
          'User-Agent': this.userAgent,
          'Cookie': this.cookiesHeader
        },
        timeout: 20000
      });

      const $ = cheerio.load(res.data);
      const posts = [];

      // Parse Reddit's modern custom shreddit-post elements
      $('shreddit-post, article, [data-testid="post-container"]').each((i, el) => {
        if (i >= 15) return;
        const art = $(el);
        const title = art.attr('post-title') || art.find('h1, h2, h3, a[href*="/comments/"]').first().text().trim();
        const permalink = art.attr('permalink') || art.find('a[href*="/comments/"]').first().attr('href') || '';
        const author = art.attr('author') || 'Reddit User';
        const id = art.attr('id') ? art.attr('id').replace('t3_', '') : Math.random().toString(36).slice(2);
        const text = art.find('[slot="text-body"], .feed-card-text, [data-click-id="text_body"]').first().text().trim();

        if (title) {
          posts.push({
            id,
            title,
            selftext: text,
            permalink,
            author
          });
        }
      });

      if (posts.length > 0) {
        await this._saveRedditPosts(posts, sub, sourceType, sourceName);
        logger.info(`✅ Reddit Layer 2: Ingested ${posts.length} posts from r/${sub} via authenticated HTML`);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`Reddit Layer 2 failed for r/${sub}: ${err.message}`);
      return false;
    }
  }

  // --- LAYER 3: Public RSS to JSON Fallback ---
  async _scrapeViaRSS(sub, sourceType, sourceName) {
    logger.debug(`Reddit Layer 3: Attempting RSS-to-JSON fallback for r/${sub}`);
    try {
      const res = await axios.get(
        `https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/${sub}/new/.rss`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000
        }
      );

      if (res.data && res.data.status === 'ok') {
        const items = res.data.items || [];
        const posts = items.map(item => {
          const guid = item.guid || item.link || '';
          const idMatch = guid.match(/\/comments\/([a-z0-9]+)\//i);
          const id = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);
          
          let content = item.content || '';
          content = content.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags

          return {
            id,
            title: item.title,
            selftext: content,
            permalink: item.link.replace('https://www.reddit.com', ''),
            author: item.author || 'Reddit User'
          };
        });

        await this._saveRedditPosts(posts, sub, sourceType, sourceName);
        logger.info(`✅ Reddit Layer 3: Ingested ${posts.length} posts from r/${sub} via RSS`);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`Reddit Layer 3 failed for r/${sub}: ${err.message}`);
      return false;
    }
  }

  async _verifyRedditSession() {
    try {
      const res = await axios.get('https://www.reddit.com/settings', {
        headers: {
          'User-Agent': this.userAgent,
          'Cookie': this.cookiesHeader
        },
        maxRedirects: 0,
        validateStatus: (status) => status === 200,
        timeout: 15000
      });
      return res.status === 200;
    } catch (err) {
      return false;
    }
  }

  async _saveRedditPosts(posts, sub, sourceType, sourceName) {
    for (const post of posts) {
      const id = post.id || Math.random().toString(36).slice(2);
      const title = post.title || '';
      const text = post.selftext || post.text || '';
      const author = post.author || 'Reddit User';
      let link = post.permalink || post.url || '';
      
      if (link && !link.startsWith('http')) {
        link = 'https://www.reddit.com' + link;
      }

      this.database.saveMessage({
        messageId: `reddit_${id}`,
        groupName: `r/${sub}`,
        groupId: `reddit_${sub}`,
        chatType: 'forum',
        senderName: author,
        senderNumber: '',
        body: `${title}\n\n${text}\nSource: ${link}`,
        timestamp: Math.floor(Date.now() / 1000),
        hasMedia: false,
        mediaCaption: '',
        isForwarded: false,
        sourceType: sourceType
      });
    }
  }

  _cleanRedditId(str) {
    if (!str) return null;
    let clean = str.trim();
    if (clean.includes('reddit.com/r/')) {
      clean = clean.split('reddit.com/r/').pop();
    }
    if (clean.startsWith('r/')) {
      clean = clean.replace('r/', '');
    }
    return clean.split('/')[0].split('?')[0];
  }
}

module.exports = RedditScraper;
