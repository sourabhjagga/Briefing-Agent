/**
 * WhatsApp Module
 * Pure Node.js socket connection using @whiskeysockets/baileys (Puppeteer-free).
 * Mapped to data/baileys_auth session folder for 100% persistent authentication.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class WhatsAppListener {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.isReady = false;
    this.messageCount = 0;
    this.isSessionAlerted = false;
    this.latestQr = null;
    this.sock = null;
    this.targetIds = new Set();
    this.authPath = path.resolve(__dirname, '../data/baileys_auth');
    this.chatNameMapFile = path.resolve(__dirname, '../data/chat-name-map.json');
    this.chatNameMap = {};
    
    // Load cached chat names
    if (fs.existsSync(this.chatNameMapFile)) {
      try {
        this.chatNameMap = JSON.parse(fs.readFileSync(this.chatNameMapFile, 'utf8'));
      } catch (err) {
        logger.error(`Failed to parse chat-name-map: ${err.message}`);
      }
    }

    this._refreshTargets();
  }

  _refreshTargets() {
    try {
      // Load targets for ALL category types ending in -whatsapp
      const allSources = this.database.getAllSources();
      const whatsappSources = allSources.filter(s => s.is_active === 1 && s.type.endsWith('-whatsapp'));
      
      this.targetIds = new Set(whatsappSources.map(s => s.source_id.trim().toLowerCase()));

      // Seed manually added database source names into chatNameMap dynamically
      let updated = false;
      allSources.forEach(s => {
        if (s.source_id && s.name) {
          const id = s.source_id.trim().toLowerCase();
          if (!this.chatNameMap[id]) {
            this.chatNameMap[id] = s.name;
            updated = true;
          }
        }
      });
      if (updated) {
        this._saveChatNameMap();
      }

      logger.info(`🎯 Mapped ${this.targetIds.size} active WhatsApp targets for strict ID filtering.`);
    } catch (err) {
      logger.error(`Failed to refresh WhatsApp targets: ${err.message}`);
    }
  }

  async start() {
    logger.info('📱 Initializing WhatsApp Baileys socket client...');
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
      
      const { version, isLatest } = await fetchLatestBaileysVersion().catch((err) => {
        logger.warn(`Could not dynamically fetch WA Web version: ${err.message}. Using stable fallback.`);
        return { version: [2, 3000, 1015024227], isLatest: false };
      });
      logger.info(`📡 WhatsApp client running with version [${version.join('.')}] (Latest: ${isLatest})`);

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Ubuntu)', 'Chrome', '110.0.5481.177'],
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('chats.set', ({ chats }) => {
        if (chats && Array.isArray(chats)) {
          let count = 0;
          chats.forEach(c => {
            if (c && c.id) {
              const id = c.id.toLowerCase().trim();
              if (id.includes('@newsletter') || id.includes('@g.us')) {
                const name = c.name || (id.includes('@newsletter') ? 'WhatsApp Channel' : 'WhatsApp Group');
                this.chatNameMap[id] = name;
                count++;
              }
            }
          });
          if (count > 0) {
            this._saveChatNameMap();
            logger.info(`📡 Synced ${count} active groups/newsletters from history sync (chats.set).`);
          }
        }
      });

      this.sock.ev.on('chats.upsert', (chats) => {
        if (chats && Array.isArray(chats)) {
          let count = 0;
          chats.forEach(c => {
            if (c && c.id) {
              const id = c.id.toLowerCase().trim();
              if (id.includes('@newsletter') || id.includes('@g.us')) {
                const name = c.name || (id.includes('@newsletter') ? 'WhatsApp Channel' : 'WhatsApp Group');
                this.chatNameMap[id] = name;
                count++;
              }
            }
          });
          if (count > 0) {
            this._saveChatNameMap();
            logger.info(`📡 Synced ${count} new/updated groups/newsletters (chats.upsert).`);
          }
        }
      });

      this.sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
        let count = 0;
        if (chats && Array.isArray(chats)) {
          chats.forEach(c => {
            if (c && c.id) {
              const id = c.id.toLowerCase().trim();
              if (id.includes('@newsletter') || id.includes('@g.us')) {
                const name = c.name || (id.includes('@newsletter') ? 'WhatsApp Channel' : 'WhatsApp Group');
                this.chatNameMap[id] = name;
                count++;
              }
            }
          });
        }
        if (contacts && Array.isArray(contacts)) {
          contacts.forEach(c => {
            if (c && c.id) {
              const id = c.id.toLowerCase().trim();
              if (id.includes('@newsletter') || id.includes('@g.us')) {
                const name = c.name || c.notify || (id.includes('@newsletter') ? 'WhatsApp Channel' : 'WhatsApp Group');
                this.chatNameMap[id] = name;
                count++;
              }
            }
          });
        }
        if (count > 0) {
          this._saveChatNameMap();
          logger.info(`📡 Synced ${count} active groups/newsletters from history sync (messaging-history.set).`);
        }
        
        // Process messages from history sync
        if (messages && Array.isArray(messages)) {
            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe) continue;
                this._processIncomingMessage(msg).catch(err => {
                    if (err.message.includes('Bad MAC')) {
                        logger.error('📱 Critical WhatsApp session error (Bad MAC). Wiping session and restarting...');
                        if (fs.existsSync(this.authPath)) {
                            fs.rmSync(this.authPath, { recursive: true, force: true });
                        }
                        // This will trigger a full restart via the connection.update handler
                        this.sock.logout();
                    } else {
                        logger.error(`Error processing history message: ${err.message}`);
                    }
                });
            }
        }
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logger.info('========================================');
          logger.info('  SCAN THIS QR CODE WITH YOUR WHATSAPP');
          logger.info('========================================');
          qrcode.generate(qr, { small: true });
          qrcode.generate(qr, { small: true });
          this.latestQr = qr;

          const adminJid = process.env.WHATSAPP_ADMIN_JID;
          if (adminJid) {
            this.sendMessage(adminJid, `📱 New WhatsApp QR code generated. Please scan to continue.`);
          }
        }

        if (connection === 'close') {
          this.isReady = false;
          this.latestQr = null;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMessage = lastDisconnect?.error?.message;
          const errorDetail = lastDisconnect?.error?.output?.payload?.error || lastDisconnect?.error?.output?.payload?.message || '';
          
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          logger.warn(`❌ WhatsApp connection closed. Reason: ${errorMessage || 'unknown'} (${errorDetail}). Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);
          
          if (!this.isSessionAlerted && this.onAlert && !shouldReconnect) {
            this.onAlert('📱 <b>WhatsApp Session Expired / Logged Out</b>\n\nYour WhatsApp session has been logged out. Please open the Web Dashboard and re-scan the QR code.');
            this.isSessionAlerted = true;
          }

          if (shouldReconnect) {
            setTimeout(() => this.start(), 10000);
          } else {
            logger.error('‼️ WhatsApp session logged out. Automatically clearing session and generating fresh QR code...');
            try {
              if (fs.existsSync(this.authPath)) {
                fs.rmSync(this.authPath, { recursive: true, force: true });
                logger.info('🧹 Successfully cleared baileys_auth credentials folder.');
              }
              setTimeout(() => {
                logger.info('🔄 Restarting WhatsApp socket in clean state to generate fresh QR...');
                this.start();
              }, 5000);
            } catch (err) {
              logger.error(`Failed to automatically clear auth path: ${err.message}`);
            }
          }
        } else if (connection === 'open') {
          this.isReady = true;
          this.isSessionAlerted = false;
          this.latestQr = null;
          logger.info('✅ WhatsApp socket client successfully connected!');
          await this._discoverChats();
        }
      });

      this.sock.ev.on('messages.upsert', async (upsert) => {
        const { messages, type } = upsert;
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          
          try {
            await this._processIncomingMessage(msg);
          } catch (err) {
            logger.error(`Error processing incoming WhatsApp message: ${err.message}`);
          }
        }
      });

    } catch (err) {
      logger.error(`Failed to start WhatsApp socket client: ${err.message}`);
      setTimeout(() => this.start(), 30000);
    }
  }

  async _processIncomingMessage(msg) {
    const remoteJid = (msg.key.remoteJid || '').toLowerCase();
    
    // Strict target filter checking JID in cached set
    if (!this.targetIds.has(remoteJid)) return;

    // Refresh target set periodically to keep DB in sync dynamically
    this._refreshTargets();
    if (!this.targetIds.has(remoteJid)) return;

    const chatName = this.chatNameMap[remoteJid] || msg.pushName || remoteJid.split('@')[0];
    this.chatNameMap[remoteJid] = chatName;
    this._saveChatNameMap();

    const body = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 msg.message?.videoMessage?.caption || 
                 '';

    if (!body) return;

    const isChannel = remoteJid.includes('@newsletter');
    const senderName = msg.pushName || 'WhatsApp User';
    const senderNumber = msg.key.participant ? msg.key.participant.split('@')[0] : '';
    const timestamp = msg.messageTimestamp ? parseInt(msg.messageTimestamp, 10) : Math.floor(Date.now() / 1000);

    const messageData = {
      messageId: msg.key.id,
      groupName: chatName,
      groupId: remoteJid,
      chatType: isChannel ? 'channel' : 'group',
      senderName: senderName,
      senderNumber: senderNumber,
      body: body,
      timestamp: timestamp,
      hasMedia: !!(msg.message?.imageMessage || msg.message?.videoMessage),
      mediaCaption: body,
      isForwarded: !!(msg.message?.extendedTextMessage?.contextInfo?.isForwarded),
      sourceType: 'cc-whatsapp'
    };

    // Determine category type dynamically based on DB source configuration
    const matchingSource = this.database.getAllSources().find(
      s => s.source_id.trim().toLowerCase() === remoteJid && s.is_active === 1
    );
    messageData.sourceType = matchingSource ? matchingSource.type : 'cc-whatsapp';

    this.database.saveMessage(messageData);
    this.messageCount++;

    logger.debug(`✉️  [WhatsApp: ${chatName}] ${senderName}: ${body.substring(0, 60)}`);
  }

  async _discoverChats() {
    logger.info('🔍 Syncing WhatsApp participating chats...');
    try {
      // In Baileys, we read contacts and groups dynamically.
      const groups = await this.sock.groupFetchAllParticipating();
      const map = {};
      
      Object.keys(groups).forEach(id => {
        const name = groups[id].subject;
        map[id.toLowerCase()] = name;
        this.chatNameMap[id.toLowerCase()] = name;
      });

      this._saveChatNameMap();
      logger.info(`✅ Synced ${Object.keys(groups).length} participating groups from account.`);

      // Sync subscribed newsletters/channels (e.g. @newsletter JIDs)
      try {
        logger.info('🔍 Fetching subscribed WhatsApp newsletters/channels...');
        // Try multiple Baileys API variants for newsletter discovery
        let newsletters = null;
        
        // Method 1: newsletterGetSubscribed (Baileys 6.7+)
        if (typeof this.sock.newsletterGetSubscribed === 'function') {
          newsletters = await this.sock.newsletterGetSubscribed();
        }
        // Method 2: Direct WA query for newsletter list
        else if (typeof this.sock.query === 'function') {
          try {
            const result = await this.sock.query({
              tag: 'iq',
              attrs: { to: '@s.whatsapp.net', xmlns: 'w:mex', type: 'get' },
              content: [{ tag: 'query', attrs: {}, content: [{ tag: 'list_type', attrs: { v: '2' } }] }]
            });
            if (result && result.content) {
              newsletters = result.content.map(c => ({
                id: c.attrs?.id || c.attrs?.jid,
                name: c.attrs?.name || c.attrs?.subject || 'WhatsApp Channel'
              })).filter(n => n.id);
            }
          } catch (queryErr) {
            logger.debug(`Newsletter raw query method not available: ${queryErr.message}`);
          }
        }

        if (newsletters && Array.isArray(newsletters) && newsletters.length > 0) {
          let newsletterCount = 0;
          newsletters.forEach(n => {
            if (n && (n.id || n.jid)) {
              const id = (n.id || n.jid).toLowerCase();
              const name = n.name || n.subject || 'WhatsApp Channel';
              this.chatNameMap[id] = name;
              newsletterCount++;
            }
          });
          this._saveChatNameMap();
          logger.info(`✅ Synced ${newsletterCount} subscribed newsletters/channels from account.`);
        } else {
          logger.info('ℹ️ No newsletters returned from API. Newsletters may still appear via passive history sync (chats.set/chats.upsert).');
        }
      } catch (newsErr) {
        logger.warn(`Could not sync WhatsApp newsletters: ${newsErr.message}. Relying on passive history sync.`);
      }

      // Seeding latest messages of target groups that are quiet in the local DB
      for (const targetId of this.targetIds) {
        const exists = this.database.db.prepare('SELECT 1 FROM messages WHERE LOWER(group_id) = ? LIMIT 1').get(targetId);
        if (!exists) {
          logger.info(`⏳ Retroactively requesting history for quiet target WhatsApp: ${targetId}`);
          try {
            // Request history from socket
            const history = await this.sock.fetchMessagesFromJid(targetId, { limit: 2 });
            if (history && history.length > 0) {
              for (const histMsg of history) {
                if (histMsg.message) {
                  await this._processIncomingMessage(histMsg);
                }
              }
            }
          } catch (fetchErr) {
            logger.debug(`Could not retroactively pull history for ${targetId}: ${fetchErr.message}`);
          }
        }
      }
    } catch (err) {
      logger.error(`WhatsApp group discovery failed: ${err.message}`);
    }
  }

  _saveChatNameMap() {
    try {
      fs.writeFileSync(this.chatNameMapFile, JSON.stringify(this.chatNameMap, null, 2), 'utf8');
    } catch (err) {
      logger.error(`Failed to save chat-name-map: ${err.message}`);
    }
  }

  getAllChats() {
    // Returns dynamic array of discovered group objects for dashboard
    return Object.keys(this.chatNameMap).map(id => ({
      id,
      name: this.chatNameMap[id]
    }));
  }

  async sendMessage(jid, text) {
    try {
      if (!this.isReady) {
        logger.warn(`WhatsApp not ready, skipping message to ${jid}`);
        return;
      }
      await this.sock.sendMessage(jid, { text });
      logger.info(`✅ Sent WhatsApp message to ${jid}`);
    } catch (err) {
      logger.error(`Failed to send WhatsApp message to ${jid}: ${err.message}`);
    }
  }

  getStatus() {
    return {
      isReady: this.isReady,
      messageCount: this.messageCount,
      targetCount: this.targetIds.size,
      qr: this.latestQr
    };
  }

  async stop() {
    if (this.sock) {
      await this.sock.end();
      this.isReady = false;
      logger.info('WhatsApp socket connection closed cleanly');
    }
  }
}

module.exports = WhatsAppListener;
