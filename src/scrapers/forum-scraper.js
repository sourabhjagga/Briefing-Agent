/**
 * Technofino Forum Scraper
 * Pure HTTP scraper utilizing Axios and Cheerio (Puppeteer-free).
 * Supports session cookies validation and automated XenForo HTTP login fallback.
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
    
    this.targets = [
      {
        name: 'Technofino VIP Lounge',
        url: 'https://technofino.in/community/forums/vip-credit-card-lounge.30/',
      },
      {
        name: 'Technofino Credit Cards Hub',
        url: 'https://technofino.in/community/categories/credit-cards.42/',
      },
      {
        name: 'Technofino Recent Posts',
        url: 'https://technofino.in/community/whats-new/posts/',
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

  async scrape() {
    logger.info('🔄 Starting Technofino HTTP scrape session...');
    try {
      const authenticated = await this._ensureAuthenticated();
      if (!authenticated) {
        logger.warn('⚠️  Scraping Technofino in GUEST mode (limited/no private lounge access).');
      }

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

  async _ensureAuthenticated() {
    let cookiesArray = null;
    
    // 1. Try loading cookies from SQLite database first
    try {
      cookiesArray = this.database.getCookies('technofino');
      if (cookiesArray && Array.isArray(cookiesArray) && cookiesArray.length > 0) {
        this.cookiesHeader = this._formatCookieHeader(cookiesArray);
        const isValid = await this._verifySession(cookiesArray);
        if (isValid) {
          logger.info('✅ Persistent Technofino session loaded from database and verified!');
          this.isSessionAlerted = false;
          return true;
        }
        logger.warn('⚠️  Database Technofino session expired or invalid.');
        cookiesArray = null;
      }
    } catch (dbErr) {
      logger.debug(`Failed to load Technofino cookies from DB: ${dbErr.message}`);
    }

    const hasCookiesFile = fs.existsSync(this.cookiePath);
    // 2. Fallback to legacy cookie file
    if (!cookiesArray && hasCookiesFile) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        cookiesArray = JSON.parse(raw);
        this.cookiesHeader = this._formatCookieHeader(cookiesArray);
        
        // Validate if session is active
        const isValid = await this._verifySession(cookiesArray);
        if (isValid) {
          logger.info('✅ Persistent Technofino session loaded from legacy file and verified!');
          // Seed back into SQLite database
          this.database.saveCookies('technofino', cookiesArray);
          this.isSessionAlerted = false; // Reset alert status on successful session check
          return true;
        }
        logger.warn('⚠️  Saved Technofino session expired or invalid.');
      } catch (err) {
        logger.error(`Failed to parse Technofino cookies file: ${err.message}`);
      }
    }

    // 2. Fallback to username/password autologin via HTTP POST
    if (this.username && this.password) {
      logger.info('🔑 Attempting Technofino login via credentials...');
      try {
        const loginSucceeded = await this._performLogin();
        if (loginSucceeded) {
          logger.info('✅ Automated Technofino login successful!');
          this.isSessionAlerted = false; // Reset alert status on successful login
          return true;
        }
      } catch (err) {
        logger.error(`Automated Technofino login failed: ${err.message}`);
      }
    }

    // 3. Alert if session was active before but now expired and credentials login failed
    if (hasCookiesFile || (this.username && this.password)) {
      if (!this.isSessionAlerted && this.onAlert) {
        this.onAlert(
          '⚠️ <b>Technofino Session Expired</b>\n\nYour Technofino forum session cookies have expired or automated credential login failed. Please login to Technofino in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard to restore authenticated access.'
        );
        this.isSessionAlerted = true;
      }
    }

    return false;
  }

  async _verifySession(cookiesArray = null) {
    try {
      // Fetch What's New which requires user session for full contents
      const res = await this._executeGetRequest('https://technofino.in/community/whats-new/posts/', cookiesArray);

      const $ = cheerio.load(res.data);
      // Check for XenForo logged-in marker (like href containing logout)
      const hasLogout = $('a[href*="logout"]').length > 0;
      return hasLogout;
    } catch (err) {
      logger.debug(`Technofino session verification check failed: ${err.message}`);
      return false;
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

    // Verify session
    const success = await this._verifySession();
    if (success) {
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
    } else {
      // Check for error blocks in page redirects if possible
      const errorHtml = cheerio.load(postRes.data);
      const errorText = errorHtml('.block-row--error').text().trim();
      throw new Error(errorText || 'Authentication redirect succeeded but verification page lacks logout link.');
    }
  }

  async _scrapeTarget(target) {
    logger.debug(`Scraping Technofino target: "${target.name}"`);
    try {
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

  _parseSetCookies(setCookieHeader) {
    if (!setCookieHeader) return [];
    return setCookieHeader.map(str => {
      const parts = str.split(';')[0].split('=');
      return {
        name: parts[0].trim(),
        value: parts[1].trim()
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
            this._saveUpdatedCookies(res.data.solution.cookies);
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

  _saveUpdatedCookies(newCookies) {
    if (!newCookies || !Array.isArray(newCookies)) return;
    try {
      const originalCookies = this.database.getCookies('technofino') || [];
      const mergedCookies = this._mergeCookies(originalCookies, newCookies, ['xf_user', 'xf_session']);

      this.database.saveCookies('technofino', mergedCookies);
      this.cookiesHeader = this._formatCookieHeader(mergedCookies);
      logger.debug('💾 [FlareSolverr] Successfully merged and updated session cookies in database.');
    } catch (e) {
      logger.debug(`Failed to save updated cookies from FlareSolverr: ${e.message}`);
    }
  }

  _mergeCookies(originalCookies, newCookies, essentialKeys) {
    if (!newCookies || !Array.isArray(newCookies)) return originalCookies;
    if (!originalCookies || !Array.isArray(originalCookies)) return newCookies;

    // Check if the new cookies list has essential logged-in keys
    const hasEssential = essentialKeys.every(key => 
      newCookies.some(c => c.name === key && c.value && c.value !== '')
    );

    const mergedMap = {};
    originalCookies.forEach(c => { mergedMap[c.name] = c; });

    newCookies.forEach(c => {
      // If the new list is unauthenticated (guest) and this is an essential key,
      // preserve the original active login cookie!
      if (essentialKeys.includes(c.name) && !hasEssential) {
        logger.debug(`[FlareSolverr] Preserving original session cookie: ${c.name}`);
        return;
      }
      mergedMap[c.name] = c;
    });

    return Object.values(mergedMap);
  }
}

module.exports = ForumScraper;
