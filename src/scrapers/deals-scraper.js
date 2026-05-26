/**
 * DesiDime Deals Scraper
 * Pure HTTP scraper utilizing Axios and Cheerio (Puppeteer-free).
 * Accurately parses DesiDime real DOM elements (li.post-unit) and manages session cookies.
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
      const authenticated = await this._ensureAuthenticated();
      if (!authenticated) {
        logger.warn('⚠️  Scraping DesiDime in GUEST mode (limited pagination or customized feed).');
      }

      const res = await axios.get(this.targetUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Cookie': this.cookiesHeader
        },
        timeout: 20000
      });

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

  async _ensureAuthenticated() {
    let cookiesArray = null;

    // 1. Try loading cookies from SQLite database first for 100% container persistence
    try {
      cookiesArray = this.database.getCookies('desidime');
      if (cookiesArray && Array.isArray(cookiesArray) && cookiesArray.length > 0) {
        this.cookiesHeader = this._formatCookieHeader(cookiesArray);
        const isValid = await this._verifySession();
        if (isValid) {
          logger.info('✅ Persistent DesiDime session cookies loaded from database and verified.');
          this.isSessionAlerted = false;
          return true;
        }
        logger.warn('⚠️  Database DesiDime session cookies expired or invalid.');
        cookiesArray = null;
      }
    } catch (dbErr) {
      logger.debug(`Failed to load DesiDime cookies from DB: ${dbErr.message}`);
    }

    const hasCookiesFile = fs.existsSync(this.cookiePath);
    // 2. Fallback to legacy cookie file
    if (!cookiesArray && hasCookiesFile) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        cookiesArray = JSON.parse(raw);
        this.cookiesHeader = this._formatCookieHeader(cookiesArray);
        
        // Verify active session
        const isValid = await this._verifySession();
        if (isValid) {
          logger.info('✅ Persistent DesiDime session cookies loaded from legacy file and verified.');
          // Seed back into SQLite database
          this.database.saveCookies('desidime', cookiesArray);
          this.isSessionAlerted = false; // Reset alert status on successful session check
          return true;
        }
        logger.warn('⚠️  Saved DesiDime session expired or invalid.');
      } catch (err) {
        logger.error(`Failed to parse DesiDime cookies: ${err.message}`);
      }
    }

    // 2. Try autologin via HTTP credentials
    if (this.username && this.password) {
      logger.info('🔑 Initiating DesiDime autologin via credentials...');
      try {
        const success = await this._performLogin();
        if (success) {
          logger.info('✅ DesiDime autologin succeeded!');
          this.isSessionAlerted = false; // Reset alert status on successful login
          return true;
        }
      } catch (err) {
        logger.error(`DesiDime credentials autologin failed: ${err.message}`);
      }
    }

    // 3. Alert if session was active before but now expired and credentials login failed
    if (hasCookiesFile || (this.username && this.password)) {
      if (!this.isSessionAlerted && this.onAlert) {
        this.onAlert(
          '⚠️ <b>DesiDime Session Expired</b>\n\nYour DesiDime deals session cookies have expired or automated credential login failed. Please login to DesiDime in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard to restore authenticated access.'
        );
        this.isSessionAlerted = true;
      }
    }

    return false;
  }

  async _verifySession() {
    try {
      const res = await axios.get('https://www.desidime.com/', {
        headers: {
          'User-Agent': this.userAgent,
          'Cookie': this.cookiesHeader
        },
        timeout: 15000
      });

      const $ = cheerio.load(res.data);
      // DesiDime logged-in markers
      const hasLogout = $('a[href*="/sign_out"], .signout, a[href*="/users/"]').length > 0;
      return hasLogout;
    } catch (err) {
      logger.debug(`DesiDime session verification failed: ${err.message}`);
      return false;
    }
  }

  async _performLogin() {
    // A. Fetch sign_in page to get CSRF authenticity_token
    const getRes = await axios.get(this.loginUrl, {
      headers: { 'User-Agent': this.userAgent },
      timeout: 15000
    });

    const $ = cheerio.load(getRes.data);
    const csrfToken = $('input[name="authenticity_token"]').first().val() || 
                      $('meta[name="csrf-token"]').attr('content');

    if (!csrfToken) {
      throw new Error('Could not retrieve authenticity_token/csrf-token from DesiDime login page.');
    }

    const initialCookies = this._parseSetCookies(getRes.headers['set-cookie']);

    // B. Post to login endpoint
    const params = new URLSearchParams();
    params.append('authenticity_token', csrfToken);
    params.append('user[login]', this.username);
    params.append('user[password]', this.password);
    params.append('user[remember_me]', '1');

    const postRes = await axios.post(this.loginUrl, params, {
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': this._formatCookieHeader(initialCookies),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const loginCookies = this._parseSetCookies(postRes.headers['set-cookie']);
    const combinedCookies = [...initialCookies, ...loginCookies];

    // Remove duplicates
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
      this.database.saveCookies('desidime', finalCookiesArray);

      // Save cookies to disk as fallback
      try {
        const dir = path.dirname(this.cookiePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.cookiePath, JSON.stringify(finalCookiesArray, null, 2), 'utf8');
      } catch (fileErr) {
        logger.debug(`Could not write DesiDime cookies to file: ${fileErr.message}`);
      }
      return true;
    } else {
      // Check for rails login alerts
      const errorHtml = cheerio.load(postRes.data);
      const errorText = errorHtml('.alert-danger, .flash-error, .error_explanation').text().trim();
      throw new Error(errorText || 'Authentication completed but no active profile session was discovered.');
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
}

module.exports = DealsScraper;
