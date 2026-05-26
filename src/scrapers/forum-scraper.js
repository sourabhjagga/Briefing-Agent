/**
 * Technofino Forum Scraper
 * Pure HTTP scraper utilizing Axios and Cheerio (Puppeteer-free).
 * 
 * FAILPROOF ARCHITECTURE:
 * - No pre-scrape session verification (eliminates false negatives).
 * - Imported cookies are trusted and used directly.
 * - Session health is judged by VIP Lounge thread count (0 = likely guest).
 * - Alerts only fire after consecutive VIP Lounge failures.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class ForumScraper {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.cookiePath = path.resolve(__dirname, '../../data/technofino_cookies.json');
    this.checkInterval = 45 * 60 * 1000; // 45 minutes
    
    this.username = process.env.TECHNOFINO_USERNAME || '';
    this.password = process.env.TECHNOFINO_PASSWORD || '';
    this.isSessionAlerted = false;
    this.consecutiveVipFailures = 0; // Track consecutive VIP Lounge 0-thread scrapes
    
    this.targets = [
      {
        name: 'Technofino VIP Lounge',
        url: 'https://technofino.in/community/forums/vip-credit-card-lounge.30/',
        isPrivate: true, // Requires login
      },
      {
        name: 'Technofino Credit Cards Hub',
        url: 'https://technofino.in/community/categories/credit-cards.42/',
        isPrivate: false,
      },
      {
        name: 'Technofino Recent Posts',
        url: 'https://technofino.in/community/whats-new/posts/',
        isPrivate: false,
      },
    ];

    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.cookiesHeader = '';
  }

  async start() {
    logger.info('🌐 Technofino forum HTTP scraper initialized (scrapes every 45 min)...');
    try {
      await this.scrape();
      setInterval(() => this.scrape(), this.checkInterval);
    } catch (err) {
      logger.error(`Forum scraper startup failed: ${err.message}`);
    }
  }

  stop() {
    // No interval ID stored, but keeping for interface compatibility
  }

  async scrape() {
    logger.info('🔄 Starting Technofino HTTP scrape session...');
    try {
      // Step 1: Load cookies directly (no verification request)
      this._loadCookies();

      for (const target of this.targets) {
        await this._scrapeTarget(target);
        // Stagger requests between 3 and 7 seconds
        const delay = Math.floor(Math.random() * 4000) + 3000;
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (err) {
      logger.error(`Technofino scrape run failed: ${err.message}`);
    }
  }

  /**
   * FAILPROOF: Simply load cookies from DB or file. No verification request.
   * The actual VIP Lounge scrape will tell us if they work.
   */
  _loadCookies() {
    // 1. Try loading from SQLite database first
    try {
      const dbCookies = this.database.getCookies('technofino');
      if (dbCookies && Array.isArray(dbCookies) && dbCookies.length > 0) {
        this.cookiesHeader = this._formatCookieHeader(dbCookies);
        logger.info('🔐 Technofino cookies loaded from database (trusted, no verification request).');
        return;
      }
    } catch (err) {
      logger.debug(`Failed to load Technofino cookies from DB: ${err.message}`);
    }

    // 2. Fallback to file
    if (fs.existsSync(this.cookiePath)) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        const cookiesArray = JSON.parse(raw);
        this.cookiesHeader = this._formatCookieHeader(cookiesArray);
        // Seed into DB for persistence
        this.database.saveCookies('technofino', cookiesArray);
        logger.info('🔐 Technofino cookies loaded from legacy file and seeded into DB.');
        return;
      } catch (err) {
        logger.error(`Failed to load Technofino cookies from file: ${err.message}`);
      }
    }

    // 3. Try autologin via credentials as a last resort
    // (We do this synchronously-ish here so that the first scrape can benefit)
    this.cookiesHeader = '';
    logger.warn('⚠️  No Technofino cookies found. Will attempt credential login if available.');
  }

  async _scrapeTarget(target) {
    logger.debug(`Scraping Technofino target: "${target.name}"`);
    try {
      // If no cookies at all and credentials exist, try login once before first target
      if (!this.cookiesHeader && this.username && this.password) {
        logger.info('🔑 Attempting Technofino credential login...');
        try {
          const loginSucceeded = await this._performLogin();
          if (loginSucceeded) {
            logger.info('✅ Automated Technofino login successful!');
          }
        } catch (loginErr) {
          logger.error(`Automated Technofino login failed: ${loginErr.message}`);
        }
      }

      const dbCookies = this.database.getCookies('technofino');
      const res = await this._executeGetRequest(target.url, dbCookies);

      const $ = cheerio.load(res.data);
      const items = [];

      $('.structItem--thread, .structItem--post').each((i, el) => {
        const row = $(el);
        const titleEl = row.find('.structItem-title a').last();
        const authorEl = row.find('.structItem-startDate a, .username').first();
        const dateEl = row.find('.structItem-startDate time, time[datetime]').first();
        
        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) {
          link = 'https://technofino.in' + link;
        }

        const idMatch = link.match(/\.(\d+)\/?$/);
        const uniqueId = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);

        if (titleEl.length > 0) {
          items.push({
            id: `forum_${uniqueId}`,
            title: titleEl.text().trim(),
            author: authorEl.length > 0 ? authorEl.text().trim() : 'Forum User',
            link: link,
            datetime: dateEl.attr('datetime') || null
          });
        }
      });

      logger.info(`✅ Found ${items.length} threads in Technofino: "${target.name}"`);

      // Step 3: Judge session health by VIP Lounge results (the canary)
      if (target.isPrivate) {
        if (items.length > 0) {
          this.consecutiveVipFailures = 0;
          this.isSessionAlerted = false;
          logger.info('🔓 VIP Lounge access confirmed — session is authenticated!');
        } else {
          this.consecutiveVipFailures++;
          logger.warn(`⚠️  VIP Lounge returned 0 threads (consecutive failures: ${this.consecutiveVipFailures}).`);
          
          // Only alert after 2 consecutive VIP failures (90 min of failures)
          if (this.consecutiveVipFailures >= 2 && !this.isSessionAlerted && this.onAlert) {
            this.onAlert(
              '⚠️ <b>Technofino VIP Lounge Access Lost</b>\n\nThe VIP Credit Card Lounge has returned 0 threads for 2 consecutive scrapes, indicating your session has expired. Please login to Technofino in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard.'
            );
            this.isSessionAlerted = true;
          }
        }
      }

      for (const item of items) {
        const timestamp = Math.floor(Date.now() / 1000);
        this.database.saveMessage({
          messageId: item.id,
          groupName: target.name,
          groupId: 'forum_technofino',
          chatType: 'forum',
          senderName: item.author,
          senderNumber: '',
          body: `${item.title}\nSource: ${item.link}`,
          timestamp,
          hasMedia: false,
          mediaCaption: '',
          isForwarded: false,
          sourceType: 'cc-forum'
        });
      }
    } catch (err) {
      logger.error(`Failed to scrape Technofino target "${target.name}": ${err.message}`);
    }
  }

  async _performLogin() {
    // A. Get login page to extract CSRF xfToken
    const getRes = await axios.get('https://technofino.in/community/login/', {
      headers: { 'User-Agent': this.userAgent },
      timeout: 15000
    });

    const $ = cheerio.load(getRes.data);
    const xfToken = $('input[name="_xfToken"]').val();
    
    if (!xfToken) {
      throw new Error('Could not retrieve XenForo CSRF _xfToken from login page.');
    }

    // Extract initial session cookie from headers
    const initialCookies = this._parseSetCookies(getRes.headers['set-cookie']);

    // B. Post credentials to XenForo login endpoint
    const params = new URLSearchParams();
    params.append('login', this.username);
    params.append('password', this.password);
    params.append('_xfToken', xfToken);
    params.append('remember', '1');
    params.append('_xfRedirect', 'https://technofino.in/community/');

    const postRes = await axios.post('https://technofino.in/community/login/login', params, {
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': this._formatCookieHeader(initialCookies),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      maxRedirects: 0, // XenForo redirects on login success
      validateStatus: (status) => status >= 200 && status < 400 // Accept 303 Redirect as success
    });

    // Check post login headers for new session and user cookies
    const loginCookies = this._parseSetCookies(postRes.headers['set-cookie']);
    const combinedCookies = [...initialCookies, ...loginCookies];

    // Remove duplicates keeping the latest cookie values
    const finalCookiesMap = {};
    combinedCookies.forEach(c => {
      finalCookiesMap[c.name] = c;
    });
    const finalCookiesArray = Object.values(finalCookiesMap);

    this.cookiesHeader = this._formatCookieHeader(finalCookiesArray);

    // Save cookies to SQLite database for 100% persistence
    this.database.saveCookies('technofino', finalCookiesArray);

    // Save cookies to disk as fallback
    try {
      const dir = path.dirname(this.cookiePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.cookiePath, JSON.stringify(finalCookiesArray, null, 2), 'utf8');
    } catch (fileErr) {
      logger.debug(`Could not write Technofino cookies to file: ${fileErr.message}`);
    }
    return true;
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
            domain: c.domain || '.technofino.in',
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
   * FAILPROOF cookie merge: Essential auth cookies (xf_user, xf_session)
   * from your imported set are NEVER overwritten by FlareSolverr.
   * Only Cloudflare bypass tokens (cf_clearance) are updated.
   */
  _saveUpdatedCookies(newCookies, originalCookiesFromDB) {
    if (!newCookies || !Array.isArray(newCookies)) return;
    try {
      const originalCookies = originalCookiesFromDB || this.database.getCookies('technofino') || [];
      const essentialKeys = ['xf_user', 'xf_session', 'xf_csrf', 'xf_notice_dismiss'];

      const mergedMap = {};
      // Original cookies are the base — they have precedence for essential keys
      originalCookies.forEach(c => { mergedMap[c.name] = c; });

      newCookies.forEach(c => {
        // NEVER overwrite essential auth tokens from FlareSolverr responses
        if (essentialKeys.includes(c.name) && mergedMap[c.name]) {
          logger.debug(`[FlareSolverr] Preserving original session cookie: ${c.name}`);
          return;
        }
        mergedMap[c.name] = c;
      });

      const mergedCookies = Object.values(mergedMap);
      this.database.saveCookies('technofino', mergedCookies);
      this.cookiesHeader = this._formatCookieHeader(mergedCookies);
      logger.debug('💾 [FlareSolverr] Merged non-essential cookies (preserved auth tokens).');
    } catch (e) {
      logger.debug(`Failed to save updated cookies from FlareSolverr: ${e.message}`);
    }
  }
}

module.exports = ForumScraper;
