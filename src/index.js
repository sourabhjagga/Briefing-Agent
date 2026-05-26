/**
 * CC & Deals Briefing Agent — Main Entry Point
 * 
 * 1. Initializes the optimized pre-compiled database layer.
 * 2. Starts pure socket-based WhatsApp and Telegram listeners in background.
 * 3. Schedules daily briefings staggered by 30 seconds.
 * 4. Runs Express server exposing source CRUD, OTP, and session cookies APIs.
 * 5. Handles graceful shutdowns under Coolify and Docker containers.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const logger = require('./logger');
const MessageDatabase = require('./database');
const WhatsAppListener = require('./whatsapp');
const TelegramUserListener = require('./telegram-user');
const TelegramBotDispatcher = require('./telegram-bot');
const Summarizer = require('./summarizer');
const Scheduler = require('./scheduler');

const ForumScraper = require('./scrapers/forum-scraper');
const DealsScraper = require('./scrapers/deals-scraper');
const RedditScraper = require('./scrapers/reddit-scraper');
const YoutubeScraper = require('./scrapers/youtube-scraper');

function validateConfig() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GEMINI_API_KEY'];
  const missing = required.filter(key => !process.env[key] || process.env[key].includes('_here'));
  if (missing.length > 0) {
    logger.error('Missing configuration! Set these in .env:');
    missing.forEach(key => logger.error(`  ❌ ${key}`));
    process.exit(1);
  }
}

// ─── Dashboard & API Express Server ──────────────────────────────────────────
function startDashboardServer(database, whatsapp, telegramUser, scheduler) {
  const PORT = parseInt(process.env.HEALTH_PORT || '3000', 10);
  const app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // Health route
  app.get('/health', (req, res) => {
    const waStatus = whatsapp.getStatus();
    const msgCount = database.getTodayMessageCount('cc');
    res.json({
      healthy: true,
      whatsapp: waStatus.isReady ? 'connected' : 'connecting',
      messagesToday: msgCount,
      targetGroups: waStatus.targetCount,
      uptime: Math.floor(process.uptime()),
    });
  });

  // API Routes for Sources
  app.get('/api/sources', (req, res) => {
    try {
      const sources = database.getAllSources();
      res.json(sources);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources', (req, res) => {
    try {
      const { name, source_id, type } = req.body;
      if (!name || !source_id || !type) return res.status(400).json({ error: 'Missing fields' });
      database.addSource(name, source_id.trim(), type);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/sources/:id', (req, res) => {
    try {
      database.deleteSource(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/sources/:id/toggle', (req, res) => {
    try {
      const { is_active } = req.body;
      database.toggleSource(req.params.id, is_active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Telegram User Auth APIs
  app.get('/api/telegram/status', (req, res) => {
    res.json({
      isReady: telegramUser.isReady,
      tempPhone: telegramUser.tempPhone
    });
  });

  app.post('/api/telegram/send-code', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) return res.status(400).json({ error: 'Missing phone number' });
      await telegramUser.sendLoginCode(phoneNumber);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/submit-code', async (req, res) => {
    try {
      const { code, password } = req.body;
      if (!code) return res.status(400).json({ error: 'Missing OTP code' });
      await telegramUser.submitLoginCode(code, password);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/logout', async (req, res) => {
    try {
      await telegramUser.logout();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Discovery Endpoint: List subscribed Telegram channels
  app.get('/api/telegram/discover', async (req, res) => {
    try {
      const channels = await telegramUser.listAllSubscribedChannels();
      res.json(channels);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Discovery Endpoint: List participating WhatsApp groups
  app.get('/api/whatsapp/discover', (req, res) => {
    try {
      const groups = whatsapp.getAllChats();
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Session Cookies Manager APIs
  app.get('/api/cookies/status', (req, res) => {
    const desidimePath = path.resolve(__dirname, '../data/desidime_cookies.json');
    const redditPath = path.resolve(__dirname, '../data/reddit_cookies.json');
    const technofinoPath = path.resolve(__dirname, '../data/technofino_cookies.json');
    res.json({
      desidime: fs.existsSync(desidimePath),
      reddit: fs.existsSync(redditPath),
      technofino: fs.existsSync(technofinoPath)
    });
  });

  app.post('/api/cookies/import', (req, res) => {
    try {
      const { site, cookies } = req.body;
      if (!site || !cookies) return res.status(400).json({ error: 'Missing site or cookies payload' });
      if (site !== 'desidime' && site !== 'reddit' && site !== 'technofino') {
        return res.status(400).json({ error: 'Invalid site name' });
      }

      let parsedCookies = cookies;
      if (typeof cookies === 'string') {
        try {
          parsedCookies = JSON.parse(cookies.trim());
        } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON format. Please paste the full cookies array.' });
        }
      }

      if (!Array.isArray(parsedCookies)) {
        return res.status(400).json({ error: 'Cookies must be a valid JSON array.' });
      }

      const targetPath = path.resolve(__dirname, `../data/${site}_cookies.json`);
      fs.writeFileSync(targetPath, JSON.stringify(parsedCookies, null, 2), 'utf8');
      logger.info(`🔐 Saved imported cookies for ${site} successfully.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cookies/delete', (req, res) => {
    try {
      const { site } = req.body;
      if (!site) return res.status(400).json({ error: 'Missing site parameter' });
      if (site !== 'desidime' && site !== 'reddit' && site !== 'technofino') {
        return res.status(400).json({ error: 'Invalid site name' });
      }

      const targetPath = path.resolve(__dirname, `../data/${site}_cookies.json`);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      logger.info(`❌ Deleted session cookies for ${site}.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(PORT, () => {
    logger.info(`🌐 Dashboard Server successfully started on port ${PORT} — http://localhost:${PORT}`);
  });
  return server;
}

async function main() {
  logger.info('🚀 CC & Deals Brief Agent Clean-Slate Starting...');
  logger.info('================================================');

  validateConfig();

  // 1. Initialize persistent pre-compiled database layer
  const database = new MessageDatabase();

  // 2. Initialize unified fallback summarization engine
  const summarizer = new Summarizer(process.env.GEMINI_API_KEY, process.env.OPENROUTER_API_KEY);

  // 3. Initialize Telegram bots
  const telegramCC = new TelegramBotDispatcher(
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID,
    database,
    summarizer,
    'cc'
  );

  let telegramDeals = null;
  if (process.env.DEALS_BOT_TOKEN) {
    telegramDeals = new TelegramBotDispatcher(
      process.env.DEALS_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID,
      database,
      summarizer,
      'deals',
      'You are a shopping deals expert. Summarize the best deals from the provided messages. Mention the product, the deal price or discount, and any links. Organize it by categories (e.g., Electronics, Fashion, Travel). Keep it exciting and brief!'
    );
  }

  // 4. Initialize active ingestion observers
  const whatsapp = new WhatsAppListener(database);
  const telegramUser = new TelegramUserListener(database);
  const scheduler = new Scheduler(summarizer, telegramCC, telegramDeals, database);

  // 5. Initialize lightweight scrapers (Puppeteer-free)
  const forumScraper = new ForumScraper(database);
  const dealsScraper = new DealsScraper(database);
  const redditScraper = new RedditScraper(database, telegramCC);
  const youtubeScraper = new YoutubeScraper(database, summarizer);

  // 6. Start Express server immediately to let Coolify healthchecks pass
  const healthServer = startDashboardServer(database, whatsapp, telegramUser, scheduler);

  // 7. Verify Telegram connection before startup
  const telegramCCConnected = await telegramCC.start();
  if (!telegramCCConnected) {
    logger.error('Cannot connect to Main Telegram Bot. Verify your TELEGRAM_BOT_TOKEN.');
    process.exit(1);
  }
  if (telegramDeals) {
    await telegramDeals.start();
  }

  // 8. Bootstrap background listeners and schedules (non-blocking)
  whatsapp.start().catch(err => logger.error(`WhatsApp listener failed: ${err.message}`));
  telegramUser.start().catch(err => logger.error(`Telegram user listener failed: ${err.message}`));
  scheduler.start();
  
  forumScraper.start();
  dealsScraper.start();
  redditScraper.start();
  youtubeScraper.start();

  // Send startup notifications
  await telegramCC.sendStartupNotification();
  if (telegramDeals) {
    await telegramDeals.sendMessage('🟢 <b>Deals Brief Agent Started</b>\nAll deals scrapers operational.');
  }

  // Graceful shutdown hooks
  const shutdown = async (signal) => {
    logger.info(`\n${signal} signal received. Powering down gracefully...`);
    scheduler.stop();
    forumScraper.stop();
    dealsScraper.stop();
    redditScraper.stop();
    youtubeScraper.stop();
    
    await whatsapp.stop();
    await telegramUser.logout();
    await telegramCC.stop();
    if (telegramDeals) await telegramDeals.stop();

    database.close();
    healthServer.close();
    logger.info('Graceful shutdown complete. Bye! 👋');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Fatal boot error: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});
