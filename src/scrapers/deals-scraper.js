/**
 * DesiDime Deals Scraper
 * Pure HTTP scraper utilizing Axios and Cheerio (Puppeteer-free).
 * 
 * FAILPROOF ARCHITECTURE:
 * - No pre-scrape session verification (eliminates false negatives).
 * - Imported cookies are trusted and used directly.
 * - Session health is judged by actual scrape results (deals found).
 * - Alerts only fire after consecutive scrape failures, not verification guesses.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class DealsScraper {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.cookiePath = path.resolve(__dirname, '../../data/desidime_cookies.json');
    this.checkInterval = 15 * 60 * 1000; // 15 minutes
    
    this.username = process.env.DESIDIME_USERNAME || '';
    this.password = process.env.DESIDIME_PASSWORD || '';
    this.isSessionAlerted = false;
    this.consecutiveFailures = 0; // Track consecutive zero-deal scrapes
    
    this.loginUrl = 'https://www.desidime.com/users/sign_in';
    this.targetUrl = 'https://www.desidime.com/forums/hot-deals-online';
    
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.cookiesHeader = '';
  }

  async start() {
    logger.info('🚀 DesiDime deals HTTP scraper initialized (scrapes every 15 min)...');
    try {
      await this.scrapeDesiDime();
      this.intervalId = setInterval(() => this.scrapeDesiDime(), this.checkInterval);
    } catch (err) {
      logger.error(`Deals Scraper startup failed: ${err.message}`);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async scrapeDesiDime() {
    logger.info('🔍 Scraping DesiDime Hot Deals via HTTP...');
    try {
      // Step 1: Load cookies (no verification request — just load and use)
      this._loadCookies();

      // Step 2: Scrape the actual target page with whatever cookies we have
      const dbCookies = this.database.getCookies('desidime');
      const res = await this._executeGetRequest(this.targetUrl, dbCookies);

      const $ = cheerio.load(res.data);
      const deals = [];

      // Parse actual DesiDime DOM elements (li.post-unit)
      $('li.post-unit').each((i, el) => {
        if (i >= 20) return; // Limit to latest 20
        const row = $(el);
        const titleEl = row.find('.post-unit__title a, a.post-link').first();
        const descEl = row.find('.post-unit__merchant-link, .post-unit__description').first();
        const priceEl = row.find('.post-unit__price, .deal-price, .discount').first();

        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) {
          link = 'https://www.desidime.com' + link;
        }

        if (titleEl.length > 0) {
          deals.push({
            title: titleEl.text().trim(),
            link: link,
            description: descEl.length > 0 ? descEl.text().trim() : '',
            price: priceEl.length > 0 ? priceEl.text().trim() : ''
          });
        }
      });

      // Fallback selector parsing in case DOM layout shifts
      if (deals.length === 0) {
        logger.warn('⚠️  Primary DOM selectors did not match any deals. Using fallback link matcher...');
        const seen = new Set();
        $('a[href*="/deals/"], a[href*="/forums/"]').each((i, el) => {
          const l = $(el);
          let href = l.attr('href') || '';
          if (href && !href.startsWith('http')) {
            href = 'https://www.desidime.com' + href;
          }
          if (seen.has(href)) return;
          seen.add(href);
          
          const text = l.text().trim();
          if (text.length > 15) {
            deals.push({
              title: text,
              link: href,
              description: '',
              price: ''
            });
          }
        });
      }

      logger.info(`✅ Successfully parsed ${deals.length} deals from DesiDime.`);

      // Step 3: Judge session health by actual results
      if (deals.length > 0) {
        this.consecutiveFailures = 0;
        this.isSessionAlerted = false;
      } else {
        this.consecutiveFailures++;
        logger.warn(`⚠️  DesiDime returned 0 deals (consecutive failures: ${this.consecutiveFailures}).`);
        
        // Only alert after 3 consecutive zero-result scrapes (45 minutes of failures)
        if (this.consecutiveFailures >= 3 && !this.isSessionAlerted && this.onAlert) {
          this.onAlert(
            '⚠️ <b>DesiDime Scraper Issue</b>\n\nDesiDime has returned 0 deals for 3 consecutive scrapes. Your session cookies may have expired. Please login to DesiDime in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard.'
          );
          this.isSessionAlerted = true;
        }
      }

      let savedCount = 0;
      for (const deal of deals) {
        if (!deal.title || !deal.link) continue;

        const cleanId = deal.link.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);

        this.database.saveMessage({
          messageId: `desidime_${cleanId}`,
          groupName: 'DesiDime Hot Deals',
          groupId: 'desidime_forum',
          chatType: 'forum',
          senderName: 'DesiDime',
          body: `🔥 <b>Deal:</b> ${deal.title}\n` +
                (deal.price ? `💰 <b>Price/Discount:</b> ${deal.price}\n` : '') +
                (deal.description ? `📝 <b>Details:</b> ${deal.description}\n` : '') +
                `🔗 <b>Link:</b> ${deal.link}`,
          timestamp: Math.floor(Date.now() / 1000),
          hasMedia: false,
          mediaCaption: '',
          isForwarded: false,
          sourceType: 'deals-forum'
        });
        savedCount++;
      }

      logger.info(`💾 Saved/Updated ${savedCount} deals in database.`);
    } catch (err) {
      logger.error(`Error during DesiDime scrape: ${err.message}`);
    }
  }

  /**
   * FAILPROOF: Simply load cookies from DB or file. No verification request.
   * The actual scrape will tell us if they work.
   */
  _loadCookies() {
    // 1. Try loading from SQLite database first
    try {
      const dbCookies = this.database.getCookies('desidime');
      if (dbCookies && Array.isArray(dbCookies) && dbCookies.length > 0) {
        this.cookiesHeader = this._formatCookieHeader(dbCookies);
        logger.debug('✅ Loaded DesiDime cookies from SQLite database.');
        return;
      }
    } catch (err) {
      logger.debug(`Failed to load DesiDime cookies from DB: ${err.message}`);
    }

    // 2. Fallback to file
    if (fs.existsSync(this.cookiePath)) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        const cookiesArray = JSON.parse(raw);
        this.cookiesHeader = this._formatCookieHeader(cookiesArray);
        // Seed into DB for persistence
        this.database.saveCookies('desidime', cookiesArray);
        logger.debug('✅ Loaded DesiDime cookies from legacy file and seeded into DB.');
        return;
      } catch (err) {
        logger.error(`Failed to load DesiDime cookies from file: ${err.message}`);
      }
    }

    // 3. No cookies available — will scrape as guest
    this.cookiesHeader = '';
    logger.debug('ℹ️  No DesiDime cookies available. Scraping as guest.');
  }

  _parseSetCookies(setCookieHeader) {
    if (!setCookieHeader) return [];
    return setCookieHeader.map(str => {
      const parts = str.split(';')[0].split('=');
      return {
        name: parts[0].trim(),
        value: parts.slice(1).join('=').trim()
      };
    });
  }

  _formatCookieHeader(cookiesArray) {
    return cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');
  }

  async _executeGetRequest(url, cookiesArray = null) {
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (flaresolverrUrl) {
      logger.debug(`[FlareSolverr] Performing GET request for: ${url}`);
      try {
        const payload = {
          cmd: 'request.get',
          url: url,
          maxTimeout: 30000,
        };
        if (cookiesArray && Array.isArray(cookiesArray) && cookiesArray.length > 0) {
          payload.cookies = cookiesArray.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain || '.desidime.com',
            path: c.path || '/'
          }));
        }
        const res = await axios.post(flaresolverrUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 35000
        });
        if (res.data && res.data.status === 'ok' && res.data.solution) {
          if (res.data.solution.cookies) {
            this._saveUpdatedCookies(res.data.solution.cookies, cookiesArray);
          }
          return { data: res.data.solution.response };
        }
        throw new Error(res.data ? res.data.message : 'Unknown FlareSolverr error');
      } catch (err) {
        logger.error(`[FlareSolverr] Failed request for ${url}: ${err.message}. Falling back to standard Axios...`);
      }
    }

    return axios.get(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': this.cookiesHeader
      },
      timeout: 20000
    });
  }

  /**
   * FAILPROOF cookie merge: Preserves original auth tokens. Only updates
   * non-essential cookies (cf_clearance, __cfduid, etc.) from FlareSolverr.
   * Essential cookies are NEVER overwritten by FlareSolverr responses.
   */
  _saveUpdatedCookies(newCookies, originalCookiesFromDB) {
    if (!newCookies || !Array.isArray(newCookies)) return;
    try {
      const originalCookies = originalCookiesFromDB || this.database.getCookies('desidime') || [];
      const essentialKeys = ['dd_auth_token', 'at', '_session_id', '_desidime_session', 'remember_user_token'];

      const mergedMap = {};
      // Original cookies are the base — they have precedence for essential keys
      originalCookies.forEach(c => { mergedMap[c.name] = c; });

      newCookies.forEach(c => {
        // NEVER overwrite essential auth tokens from FlareSolverr guest responses
        if (essentialKeys.includes(c.name) && mergedMap[c.name]) {
          logger.debug(`[FlareSolverr] Preserving original session cookie: ${c.name}`);
          return;
        }
        mergedMap[c.name] = c;
      });

      const mergedCookies = Object.values(mergedMap);
      this.database.saveCookies('desidime', mergedCookies);
      this.cookiesHeader = this._formatCookieHeader(mergedCookies);
      logger.debug('💾 [FlareSolverr] Merged non-essential cookies (preserved auth tokens).');
    } catch (e) {
      logger.debug(`Failed to save updated cookies from FlareSolverr: ${e.message}`);
    }
  }
}

module.exports = DealsScraper;
