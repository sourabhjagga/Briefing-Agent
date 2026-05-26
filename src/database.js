/**
 * Database Module
 * High-performance, pre-compiled query layer for storing, retrieving, and searching messages/sources.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class MessageDatabase {
  constructor(dbPath) {
    const resolvedPath = path.resolve(dbPath || process.env.DB_PATH || './data/messages.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    
    this._initialize();
    this._compileStatements();
    
    logger.info(`✅ SQLite Database initialized at: ${resolvedPath}`);
  }

  _initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE,
        group_name TEXT NOT NULL,
        group_id TEXT,
        chat_type TEXT DEFAULT 'group',
        sender_name TEXT,
        sender_number TEXT,
        body TEXT,
        timestamp INTEGER NOT NULL,
        has_media INTEGER DEFAULT 0,
        media_caption TEXT,
        is_forwarded INTEGER DEFAULT 0,
        source_type TEXT DEFAULT 'cc-whatsapp',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
      CREATE INDEX IF NOT EXISTS idx_messages_search ON messages(body, source_type);
      CREATE INDEX IF NOT EXISTS idx_messages_composite ON messages(source_type, timestamp);

      CREATE TABLE IF NOT EXISTS summary_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary_date TEXT NOT NULL,
        message_count INTEGER,
        summary_text TEXT,
        sent_to_telegram INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS daily_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_date TEXT NOT NULL UNIQUE,
        brief_text TEXT NOT NULL,
        message_count INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _compileStatements() {
    this.statements = {
      saveMessage: this.db.prepare(`
        INSERT OR IGNORE INTO messages 
          (message_id, group_name, group_id, chat_type, sender_name, sender_number, body, timestamp, has_media, media_caption, is_forwarded, source_type)
        VALUES 
          (@message_id, @group_name, @group_id, @chat_type, @sender_name, @sender_number, @body, @timestamp, @has_media, @media_caption, @is_forwarded, @source_type)
      `),
      getTodayMessages: this.db.prepare(`
        SELECT group_name, group_id, chat_type, sender_name, body, timestamp, has_media, media_caption, is_forwarded
        FROM messages WHERE timestamp >= ? AND source_type LIKE ?
        ORDER BY group_name, timestamp ASC
      `),
      getTodayActiveGroups: this.db.prepare(`
        SELECT group_name, group_id, chat_type, COUNT(*) as count
        FROM messages WHERE timestamp >= ? AND source_type LIKE ?
        GROUP BY group_id
        ORDER BY count DESC
      `),
      searchMessages: this.db.prepare(`
        SELECT group_name, sender_name, body, timestamp, chat_type
        FROM messages
        WHERE body LIKE ? AND source_type LIKE ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      getMessagesByTopic: this.db.prepare(`
        SELECT group_name, sender_name, body, timestamp, chat_type
        FROM messages
        WHERE body LIKE ? AND timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT 50
      `),
      saveBrief: this.db.prepare(`
        INSERT OR REPLACE INTO daily_briefs (brief_date, brief_text, message_count)
        VALUES (?, ?, ?)
      `),
      getBrief: this.db.prepare(`
        SELECT * FROM daily_briefs WHERE brief_date = ?
      `),
      getAllBriefs: this.db.prepare(`
        SELECT brief_date, message_count, created_at FROM daily_briefs ORDER BY created_at DESC LIMIT ?
      `),
      saveSummary: this.db.prepare(`
        INSERT INTO summary_log (summary_date, message_count, summary_text, sent_to_telegram)
        VALUES (?, ?, ?, ?)
      `),
      getStatsTotal: this.db.prepare(`
        SELECT COUNT(*) as total FROM messages WHERE timestamp >= ? AND source_type LIKE ?
      `),
      getStatsByGroup: this.db.prepare(`
        SELECT group_name, chat_type, COUNT(*) as count 
        FROM messages WHERE timestamp >= ? AND source_type LIKE ?
        GROUP BY group_name ORDER BY count DESC
      `),
      cleanup: this.db.prepare(`
        DELETE FROM messages WHERE timestamp < ?
      `),
      getAllSources: this.db.prepare(`
        SELECT * FROM sources ORDER BY created_at DESC
      `),
      getActiveSourcesByType: this.db.prepare(`
        SELECT source_id FROM sources WHERE type = ? AND is_active = 1
      `),
      addSource: this.db.prepare(`
        INSERT INTO sources (name, source_id, type, is_active)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(source_id) DO UPDATE SET 
          name=excluded.name, 
          type=excluded.type, 
          is_active=1
      `),
      addSourceInactive: this.db.prepare(`
        INSERT OR IGNORE INTO sources (name, source_id, type, is_active)
        VALUES (?, ?, ?, 0)
      `),
      toggleSource: this.db.prepare(`
        UPDATE sources SET is_active = ? WHERE id = ?
      `),
      deleteSource: this.db.prepare(`
        DELETE FROM sources WHERE id = ?
      `)
    };
  }

  saveMessage(message) {
    try {
      this.statements.saveMessage.run({
        message_id: message.messageId,
        group_name: message.groupName,
        group_id: message.groupId || '',
        chat_type: message.chatType || 'group',
        sender_name: message.senderName || 'Unknown',
        sender_number: message.senderNumber || '',
        body: message.body || '',
        timestamp: message.timestamp,
        has_media: message.hasMedia ? 1 : 0,
        media_caption: message.mediaCaption || '',
        is_forwarded: message.isForwarded ? 1 : 0,
        source_type: message.sourceType || 'cc-whatsapp',
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint')) {
        logger.error(`Failed to save message: ${err.message}`);
      }
    }
  }

  getTodayMessages(sourcePrefix = 'cc') {
    const midnightUTC = this._getMidnightIST();
    return this.statements.getTodayMessages.all(midnightUTC, `${sourcePrefix}%`);
  }

  getTodayMessageCount(sourcePrefix = 'cc') {
    return this.getTodayMessages(sourcePrefix).length;
  }

  getTodayActiveGroups(sourcePrefix = 'cc') {
    const midnightUTC = this._getMidnightIST();
    return this.statements.getTodayActiveGroups.all(midnightUTC, `${sourcePrefix}%`);
  }

  searchMessages(keyword, limit = 20, sourcePrefix = 'cc') {
    return this.statements.searchMessages.all(`%${keyword}%`, `${sourcePrefix}%`, limit);
  }

  getMessagesByTopic(topic, days = 7) {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    return this.statements.getMessagesByTopic.all(`%${topic}%`, since);
  }

  saveBrief(date, briefText, messageCount) {
    this.statements.saveBrief.run(date, briefText, messageCount);
  }

  getBrief(date) {
    return this.statements.getBrief.get(date);
  }

  getAllBriefs(limit = 30) {
    return this.statements.getAllBriefs.all(limit);
  }

  saveSummary(date, messageCount, summaryText, sentToTelegram) {
    this.statements.saveSummary.run(date, messageCount, summaryText, sentToTelegram ? 1 : 0);
  }

  getStats(days = 7, sourcePrefix = 'cc') {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const total = this.statements.getStatsTotal.get(since, `${sourcePrefix}%`).total;
    const groups = this.statements.getStatsByGroup.all(since, `${sourcePrefix}%`);
    return {
      totalMessages: total,
      byGroup: groups,
    };
  }

  cleanup(daysToKeep = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 24 * 60 * 60;
    const result = this.statements.cleanup.run(cutoff);
    if (result.changes > 0) {
      logger.info(`🧹 Cleaned up ${result.changes} messages older than ${daysToKeep} days`);
    }
  }

  getAllSources() {
    return this.statements.getAllSources.all();
  }

  getActiveSourcesByType(type) {
    return this.statements.getActiveSourcesByType.all(type).map(row => row.source_id);
  }

  addSource(name, sourceId, type) {
    this.statements.addSource.run(name, sourceId, type);
  }

  addSourceInactive(name, sourceId, type) {
    this.statements.addSourceInactive.run(name, sourceId, type);
  }

  toggleSource(id, isActive) {
    this.statements.toggleSource.run(isActive ? 1 : 0, id);
  }

  deleteSource(id) {
    this.statements.deleteSource.run(id);
  }

  _getMidnightIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const istMidnight = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
    return Math.floor((istMidnight.getTime() - istOffset) / 1000);
  }

  close() {
    this.db.close();
    logger.info('Database connection closed');
  }
}

module.exports = MessageDatabase;
