/**
 * DesiDime Deals Scraper (Puppeteer Stealth Headless Upgrade)
 * 
 * FAILPROOF BROWSER-BASED EXTRACTION:
 * - Natively handles and bypasses Cloudflare turnstile and shield protections.
 * - Restores imported login cookies seamlessly inside the browser context.
 * - Synchronizes active browser cookies back to the SQLite DB to maintain active session health.
 * - Automatically falls back to GUEST mode if cookies are empty or expired.
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const browserManager = require('../browser-manager');

class DealsScraper {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.cookiePath = path.resolve(__dirname, '../../data/desidime_cookies.json');
    this.checkInterval = 15 * 60 * 1000; // 15 minutes
    
    this.isSessionAlerted = false;
    this.consecutiveFailures = 0; // Track consecutive zero-deal scrapes
    this.targetUrl = 'https://www.desidime.com/forums/hot-deals-online';
  }

  async start() {
    logger.info('🚀 DesiDime deals Puppeteer scraper initialized (scrapes every 15 min)...');
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
    logger.info('🔍 Scraping DesiDime Hot Deals via Headless Browser...');
    let page = null;
    try {
      // 1. Open new tab inside the shared browser instance
      page = await browserManager.newPage();

      // 2. Set authenticated cookies inside browser session if available
      await this._injectCookies(page);

      // 3. Navigate to target url
      logger.debug(`Navigating to DesiDime: ${this.targetUrl}`);
      await page.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // 4. Stagger and wait for content/selectors to settle
      // Use a broad selector that covers DesiDime's current and legacy DOM layouts
      const PRIMARY_SELECTOR = 'li.post-unit, article.deal-card, .deal-item, .post-card, .thread-item, div[class*="deal"]';
      try {
        await page.waitForSelector(`${PRIMARY_SELECTOR}, a[href*="/deals/"]`, { timeout: 15000 });
      } catch (e) {
        logger.debug(`Timeout waiting for primary selector. Processing current DOM structure...`);
      }

      // 5. Sync cookies from browser back to database to maintain Cloudflare and session tokens
      const currentCookies = await page.cookies();
      this._saveUpdatedCookies(currentCookies);

      // 6. Extract page HTML and parse via Cheerio
      const html = await page.content();
      const $ = cheerio.load(html);
      const deals = [];

      // Parse DesiDime deal items — covers multiple DOM layout versions
      $(PRIMARY_SELECTOR).each((i, el) => {
        if (i >= 25) return; // Limit to latest 25
        const row = $(el);
        // Title link — try multiple class patterns
        const titleEl = row.find(
          '.post-unit__title a, a.post-link, .deal-card__title a, .deal-item__title a, h2 a, h3 a, .title a'
        ).first();
        // Description / merchant
        const descEl = row.find(
          '.post-unit__merchant-link, .post-unit__description, .deal-card__merchant, .deal-description'
        ).first();
        // Price / discount
        const priceEl = row.find(
          '.post-unit__price, .deal-price, .discount, .deal-card__price, [class*="price"], [class*="discount"]'
        ).first();

        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) {
          link = 'https://www.desidime.com' + link;
        }

        if (titleEl.length > 0 && titleEl.text().trim().length > 5) {
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

      // 7. Judge session health by actual results
      if (deals.length > 0) {
        this.consecutiveFailures = 0;
        this.isSessionAlerted = false;
      } else {
        this.consecutiveFailures++;
        logger.warn(`⚠️  DesiDime returned 0 deals (consecutive failures: ${this.consecutiveFailures}).`);
        
        // Alert after 3 consecutive failures
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
                `🔗 <a href="${deal.link}">View Deal</a>`,
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
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.debug(`Error closing page: ${e.message}`);
        }
      }
    }
  }

  async _injectCookies(page) {
    let cookiesArray = this.database.getCookies('desidime');
    if (!cookiesArray && fs.existsSync(this.cookiePath)) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        cookiesArray = JSON.parse(raw);
        this.database.saveCookies('desidime', cookiesArray);
      } catch (err) {
        logger.error(`Failed to load cookies file: ${err.message}`);
      }
    }

    if (cookiesArray && Array.isArray(cookiesArray) && cookiesArray.length > 0) {
      logger.debug(`Injecting ${cookiesArray.length} cookies into browser tab for DesiDime...`);
      // Standardize cookies array format for Puppeteer
      const sanitized = cookiesArray.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path: c.path || '/'
      }));
      await page.setCookie(...sanitized);
    }
  }

  _saveUpdatedCookies(newCookies) {
    if (!newCookies || !Array.isArray(newCookies)) return;
    try {
      const originalCookies = this.database.getCookies('desidime') || [];
      const essentialKeys = ['dd_auth_token', 'at', '_session_id', '_desidime_session', 'remember_user_token'];

      const mergedMap = {};
      originalCookies.forEach(c => { mergedMap[c.name] = c; });

      newCookies.forEach(c => {
        // Essential cookies from manual import are preserved unless updated with authentic values
        if (essentialKeys.includes(c.name) && mergedMap[c.name] && !c.value) {
          return;
        }
        mergedMap[c.name] = c;
      });

      const mergedCookies = Object.values(mergedMap);
      this.database.saveCookies('desidime', mergedCookies);
    } catch (e) {
      logger.debug(`Failed to save updated cookies: ${e.message}`);
    }
  }
}

module.exports = DealsScraper;
