/**
 * Telegram User Listener Module
 * Connects as a real Telegram user session (MTProto) using gramjs (Puppeteer-free).
 * Supports OTP, 2FA verification, channel discovery, and private channel scraping.
 */

const { TelegramClient, Api, password } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class TelegramUserListener {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.sessionPath = path.resolve(__dirname, '../data/telegram_user_session.txt');
    
    // Dynamic override from env with high-priority custom credential binding
    let apiId = parseInt(process.env.TELEGRAM_API_ID || '37610922', 10);
    let apiHash = process.env.TELEGRAM_API_HASH || '9bd1b33f3902903c866b1d2d0ab014aa';
    
    if (apiId === 17349 || apiId === 2040 || !apiId || apiId === 0) {
      apiId = 37610922;
      apiHash = '9bd1b33f3902903c866b1d2d0ab014aa';
    }
    
    this.apiId = apiId;
    this.apiHash = apiHash;
    
    let initialSession = '';
    if (fs.existsSync(this.sessionPath)) {
      initialSession = fs.readFileSync(this.sessionPath, 'utf8').trim();
    }
    
    const clientOptions = {
      connectionRetries: 5,
    };

    const proxyUrl = process.env.TELEGRAM_PROXY;
    if (proxyUrl) {
      const url = require('url');
      const parsed = url.parse(proxyUrl);
      clientOptions.proxy = {
        ip: parsed.hostname,
        port: parseInt(parsed.port, 10),
        socksType: 5,
      };
      if (parsed.auth) {
        const [username, password] = parsed.auth.split(':');
        clientOptions.proxy.username = username;
        clientOptions.proxy.password = password;
      }
      logger.info(`🔌 Routing Telegram User client through proxy: ${parsed.hostname}:${parsed.port}`);
    }

    this.session = new StringSession(initialSession);
    this.client = new TelegramClient(this.session, this.apiId, this.apiHash, clientOptions);
    
    this.isReady = false;
    this.tempPhone = null;
    this.tempHash = null;
    this.isSessionAlerted = false;
  }

  async start() {
    logger.info('📱 Initializing personal Telegram account connection...');
    
    // Check if a saved session exists. If not, skip startup connect to prevent hanging and let the user log in dynamically
    const hasSession = fs.existsSync(this.sessionPath) && fs.readFileSync(this.sessionPath, 'utf8').trim().length > 0;
    if (!hasSession) {
      logger.warn('⚠️ No Telegram personal session found. Please log in via the Web Dashboard.');
      return;
    }

    try {
      // Connect to Telegram DC with a 20-second hard timeout to avoid blocking the Express API server
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Telegram connection timeout')), 20000))
      ]);
      
      const isAuthorized = await Promise.race([
        this.client.isUserAuthorized().catch(() => false),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Telegram auth check timeout')), 10000))
      ]).catch(() => false);

      if (isAuthorized) {
        this.isReady = true;
        this.isSessionAlerted = false; // Reset alert status on successful startup
        logger.info('✅ Personal Telegram account successfully connected (Session loaded)!');
        this.scrapePrivateChannels();
        setInterval(() => this.scrapePrivateChannels(), 10 * 60 * 1000); // Scrape every 10 min
      } else {
        logger.warn('⚠️ Telegram personal account session is expired or invalid. Please log in again.');
        if (!this.isSessionAlerted && this.onAlert) {
          this.onAlert('📱 <b>Telegram User Session Expired</b>\n\nYour personal Telegram account session has expired or is invalid. Please log in again via the Web Dashboard.');
          this.isSessionAlerted = true;
        }
      }
    } catch (err) {
      logger.error(`Failed to initialize Telegram User listener: ${err.message}`);
    }
  }

  // --- OTP & 2FA LOGIN HANDSHAKE ---

  async sendLoginCode(phoneNumber) {
    logger.info(`📡 Requesting Telegram login code for: ${phoneNumber}`);
    
    // Connect to Telegram DC with a 20-second timeout if not already connected
    if (!this.client.connected) {
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Telegram connection timeout during OTP request')), 20000))
      ]);
    }
    
    // Send verification code with a 15-second timeout
    const result = await Promise.race([
      this.client.sendCode(
        {
          apiId: this.apiId,
          apiHash: this.apiHash,
        },
        phoneNumber
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Telegram server took too long to send code')), 15000))
    ]);

    this.tempPhone = phoneNumber;
    this.tempHash = result.phoneCodeHash;
    return this.tempHash;
  }

  async submitLoginCode(code, passwordInput = null) {
    logger.info(`📡 Submitting Telegram login code for phone: ${this.tempPhone}`);
    if (!this.tempPhone || !this.tempHash) {
      throw new Error('No active login session. Please send code first.');
    }
    
    let signInResult;
    try {
      // 1. Direct MTProto Sign In using the phoneCode and phoneCodeHash
      signInResult = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.tempPhone,
          phoneCodeHash: this.tempHash,
          phoneCode: code,
        })
      );
    } catch (err) {
      // 2. Handle 2FA Password if enabled
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        logger.info('🔒 2FA Password required for Telegram account.');
        if (!passwordInput) {
          throw new Error('2FA is enabled on this account. Please enter your 2FA password.');
        }
        
        const passwordSrpResult = await this.client.invoke(new Api.account.GetPassword());
        const passwordSrpCheck = await password.computeCheck(passwordSrpResult, passwordInput);
        
        signInResult = await this.client.invoke(
          new Api.auth.CheckPassword({
            password: passwordSrpCheck,
          })
        );
      } else {
        throw err;
      }
    }

    // Save session on success
    const sessionString = this.client.session.save();
    const dir = path.dirname(this.sessionPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.sessionPath, sessionString, 'utf8');
    
    this.isReady = true;
    logger.info('✅ Personal Telegram account successfully connected via OTP & 2FA!');
    
    // Clear temp storage
    this.tempPhone = null;
    this.tempHash = null;
    
    // Auto-discover and seed sources dynamically
    await this.autoDiscoverAndSeedSources();
    
    // Start scraper
    this.scrapePrivateChannels();
    setInterval(() => this.scrapePrivateChannels(), 10 * 60 * 1000);
    return true;
  }

  async logout() {
    if (fs.existsSync(this.sessionPath)) {
      fs.unlinkSync(this.sessionPath);
    }
    this.isReady = false;
    await this.client.disconnect();
    
    // Reinitialize to clear session
    this.session = new StringSession('');
    this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
      connectionRetries: 5,
    });
    logger.info('❌ Personal Telegram account logged out and session cleared.');
    return true;
  }

  // --- SOURCE DISCOVERY & SEEDING ---

  async listAllSubscribedChannels() {
    if (!this.isReady) return [];
    try {
      logger.info('📡 Fetching all subscribed dialogs from personal Telegram account...');
      const dialogs = await this.client.getDialogs({});
      return dialogs
        .filter(d => d.isChannel || d.isGroup)
        .map(d => ({
          id: d.id.toString(),
          name: d.title || 'Private Chat',
          type: d.isChannel ? 'channel' : 'group'
        }));
    } catch (err) {
      logger.error(`Failed to list subscribed Telegram dialogs: ${err.message}`);
      return [];
    }
  }

  async autoDiscoverAndSeedSources() {
    try {
      logger.info('🔍 Seeding discovered channels in database as inactive...');
      const channels = await this.listAllSubscribedChannels();
      let count = 0;
      for (const ch of channels) {
        const type = ch.type === 'channel' ? 'cc-telegram' : 'deals-telegram';
        this.database.addSourceInactive(ch.name, ch.id, type);
        count++;
      }
      logger.info(`✅ Auto-seeded ${count} discovered Telegram sources in inactive state.`);
    } catch (err) {
      logger.error(`Auto-discovery seeding failed: ${err.message}`);
    }
  }

  // --- INGESTION SCRAPER ---

  async scrapePrivateChannels() {
    if (!this.isReady) return;
    
    logger.info('📡 Starting personal Telegram channels scrape session...');
    try {
      // Live session check
      const isAuthorized = await this.client.isUserAuthorized().catch(() => false);
      if (!isAuthorized) {
        this.isReady = false;
        logger.warn('⚠️ Telegram user session lost during scrape.');
        if (!this.isSessionAlerted && this.onAlert) {
          this.onAlert('📱 <b>Telegram User Session Lost</b>\n\nYour personal Telegram account session was disconnected or terminated. Please log in again via the Web Dashboard.');
          this.isSessionAlerted = true;
        }
        return;
      }
      this.isSessionAlerted = false; // Reset if validation passes

      const allSources = this.database.getAllSources();
      // Filter for active Telegram sources
      const activeTelegram = allSources.filter(
        s => s.is_active === 1 && (s.type === 'cc-telegram' || s.type === 'deals-telegram')
      );

      for (const source of activeTelegram) {
        const sourceId = source.source_id.trim();
        
        logger.info(`📡 Scraping Telegram source: "${source.name}" (${sourceId})`);
        try {
          // Resolve standard numerical group/channel IDs as BigInt
          let entity = sourceId;
          if (/^-?\d+$/.test(sourceId)) {
            entity = BigInt(sourceId);
          }

          // Fetch messages directly using official Telegram MTProto APIs
          const messages = await this.client.getMessages(entity, { limit: 15 });
          
          let savedCount = 0;
          for (const msg of messages) {
            if (!msg.message) continue;
            
            this.database.saveMessage({
              messageId: `tg_private_${sourceId.replace('-', '')}_${msg.id}`,
              groupName: source.name,
              groupId: `telegram_private_${sourceId}`,
              chatType: 'channel',
              senderName: source.name,
              senderNumber: '',
              body: msg.message,
              timestamp: msg.date,
              hasMedia: !!msg.media,
              mediaCaption: '',
              isForwarded: !!msg.forwardFrom,
              sourceType: source.type
            });
            savedCount++;
          }
          logger.info(`✅ Successfully scraped ${savedCount} messages from: "${source.name}"`);
        } catch (err) {
          logger.error(`Error scraping Telegram "${source.name}" (${sourceId}): ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Error in scrapePrivateChannels: ${err.message}`);
    }
  }
}

module.exports = TelegramUserListener;
