/**
 * WhatsApp Module
 * Pure Node.js socket connection using @whiskeysockets/baileys (Puppeteer-free).
 * Mapped to data/baileys_auth session folder for 100% persistent authentication.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class WhatsAppListener {
  constructor(database) {
    this.database = database;
    this.isReady = false;
    this.messageCount = 0;
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
      const activeCc = this.database.getActiveSourcesByType('cc-whatsapp');
      const activeDeals = this.database.getActiveSourcesByType('deals-whatsapp');
      const combined = [...activeCc, ...activeDeals];
      
      this.targetIds = new Set(combined.map(id => id.trim().toLowerCase()));
      logger.info(`🎯 Mapped ${this.targetIds.size} active WhatsApp targets for strict ID filtering.`);
    } catch (err) {
      logger.error(`Failed to refresh WhatsApp targets: ${err.message}`);
    }
  }

  async start() {
    logger.info('📱 Initializing WhatsApp Baileys socket client...');
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
      
      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false // Handled manually below for logs styling
      });

      // Listen for credentials updates to save session
      this.sock.ev.on('creds.update', saveCreds);

      // Listen for connection states
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logger.info('========================================');
          logger.info('  SCAN THIS QR CODE WITH YOUR WHATSAPP');
          logger.info('========================================');
          qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
          this.isReady = false;
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          logger.warn(`❌ WhatsApp connection closed. Reason: ${lastDisconnect?.error?.message || 'unknown'}. Reconnecting: ${shouldReconnect}`);
          
          if (shouldReconnect) {
            setTimeout(() => this.start(), 5000);
          } else {
            logger.error('‼️ WhatsApp session logged out. Please clear data/baileys_auth and re-scan.');
          }
        } else if (connection === 'open') {
          this.isReady = true;
          logger.info('✅ WhatsApp socket client successfully connected!');
          await this._discoverChats();
        }
      });

      // Listen for incoming messages
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
      setTimeout(() => this.start(), 30000); // Retry in 30 seconds
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
      sourceType: isChannel ? 'cc-whatsapp' : 'cc-whatsapp' // Categorized dynamically
    };

    // Determine CC or Deals type based on DB source configuration
    const activeCc = this.database.getActiveSourcesByType('cc-whatsapp');
    const isCc = activeCc.some(id => id.toLowerCase() === remoteJid);
    messageData.sourceType = isCc ? 'cc-whatsapp' : 'deals-whatsapp';

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

  getStatus() {
    return {
      isReady: this.isReady,
      messageCount: this.messageCount,
      targetCount: this.targetIds.size,
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
