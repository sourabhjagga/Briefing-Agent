/**
 * CC & Deals Briefing Agent — Main Entry Point
 * 
 * 1. Initializes the optimized pre-compiled database layer.
 * 2. Seeds default CC & Deals categories and loads all custom categories.
 * 3. Creates Telegram bot instances for each active category.
 * 4. Starts pure socket-based WhatsApp and Telegram listeners in background.
 * 5. Schedules daily briefings staggered by 30 seconds per category.
 * 6. Runs Express server exposing source CRUD, category CRUD, OTP, and session cookies APIs.
 * 7. Handles graceful shutdowns under Coolify and Docker containers.
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

// ─── Dynamic Bot Instance Factory ──────────────────────────────────────────
function createBotInstances(database, summarizer) {
  const categories = database.getActiveCategories();
  const botInstances = new Map();

  for (const cat of categories) {
    const token = cat.bot_token;
    const chatId = cat.chat_id;

    if (!token || !chatId) {
      logger.warn(`⚠️ Category "${cat.display_name}" (${cat.slug}) is missing bot_token or chat_id. Skipping bot creation.`);
      continue;
    }

    try {
      const bot = new TelegramBotDispatcher(
        token,
        chatId,
        database,
        summarizer,
        cat.slug,
        cat.ai_prompt || undefined
      );
      botInstances.set(cat.slug, bot);
      logger.info(`🤖 Created bot instance for category: ${cat.display_name} (${cat.slug})`);
    } catch (err) {
      logger.error(`Failed to create bot for category "${cat.slug}": ${err.message}`);
    }
  }

  return botInstances;
}

// ─── Dashboard & API Express Server ──────────────────────────────────────────
function startDashboardServer(database, whatsapp, telegramUser, scheduler, summarizer, botInstances) {
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
      whatsappQr: waStatus.qr || null,
      messagesToday: msgCount,
      targetGroups: waStatus.targetCount,
      uptime: Math.floor(process.uptime()),
    });
  });

  // ─── Sources CRUD ────────────────────────────────────────────────────────
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

  // ─── Categories CRUD ─────────────────────────────────────────────────────
  app.get('/api/categories', (req, res) => {
    try {
      const categories = database.getAllCategories();
      res.json(categories);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/categories', async (req, res) => {
    try {
      const { slug, display_name, bot_token, chat_id, ai_prompt } = req.body;
      if (!slug || !display_name) {
        return res.status(400).json({ error: 'Missing slug or display_name' });
      }
      // Validate slug: lowercase, alphanumeric + hyphens only
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' });
      }
      database.addCategory(slug, display_name, bot_token, chat_id, ai_prompt);
      
      // Hot-reload: create bot instance if token+chatId provided
      if (bot_token && chat_id) {
        try {
          const newBot = new TelegramBotDispatcher(
            bot_token,
            chat_id,
            database,
            summarizer,
            slug,
            ai_prompt || undefined
          );
          botInstances.set(slug, newBot);
          await newBot.start();
          scheduler.updateBotInstances(botInstances);
          logger.info(`🔄 Hot-loaded new bot instance for category: ${slug}`);
        } catch (botErr) {
          logger.error(`Bot creation failed for new category "${slug}": ${botErr.message}`);
        }
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/categories/:id', async (req, res) => {
    try {
      const { display_name, bot_token, chat_id, ai_prompt, is_active } = req.body;
      if (!display_name) return res.status(400).json({ error: 'Missing display_name' });
      database.updateCategory(req.params.id, display_name, bot_token, chat_id, ai_prompt, is_active !== undefined ? is_active : 1);

      // Hot-reload: recreate bot instances
      const updatedCat = database.getAllCategories().find(c => c.id === parseInt(req.params.id));
      if (updatedCat && bot_token && chat_id) {
        try {
          // Stop old bot if exists
          const oldBot = botInstances.get(updatedCat.slug);
          if (oldBot) {
            await oldBot.stop();
            botInstances.delete(updatedCat.slug);
          }
          // Create new bot
          const newBot = new TelegramBotDispatcher(
            bot_token,
            chat_id,
            database,
            summarizer,
            updatedCat.slug,
            ai_prompt || undefined
          );
          botInstances.set(updatedCat.slug, newBot);
          await newBot.start();
          scheduler.updateBotInstances(botInstances);
          logger.info(`🔄 Hot-reloaded bot instance for category: ${updatedCat.slug}`);
        } catch (botErr) {
          logger.error(`Bot hot-reload failed for category "${updatedCat.slug}": ${botErr.message}`);
        }
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/categories/:id', async (req, res) => {
    try {
      // Find category before deletion to clean up bot
      const allCats = database.getAllCategories();
      const cat = allCats.find(c => c.id === parseInt(req.params.id));
      
      if (cat && (cat.slug === 'cc' || cat.slug === 'deals')) {
        return res.status(400).json({ error: 'Cannot delete built-in CC or Deals categories' });
      }

      const result = database.deleteCategory(req.params.id);
      
      // Clean up bot instance
      if (cat && botInstances.has(cat.slug)) {
        try {
          await botInstances.get(cat.slug).stop();
        } catch (e) { /* ignore */ }
        botInstances.delete(cat.slug);
        scheduler.updateBotInstances(botInstances);
      }

      // Also delete all sources associated with this category
      if (cat) {
        const catSources = database.getSourcesByCategory(cat.slug);
        catSources.forEach(s => database.deleteSource(s.id));
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/categories/:id/test', async (req, res) => {
    try {
      const cat = database.getAllCategories().find(c => c.id === parseInt(req.params.id));
      if (!cat) return res.status(404).json({ error: 'Category not found' });
      if (!cat.bot_token || !cat.chat_id) {
        return res.status(400).json({ error: 'Category must have a bot token and chat ID configured' });
      }

      // Try sending a test message via the bot
      const { Telegraf } = require('telegraf');
      const testBot = new Telegraf(cat.bot_token);
      await testBot.telegram.sendMessage(cat.chat_id, 
        `🧪 <b>Test Message</b>\n\n✅ Category "${cat.display_name}" is configured correctly!\nBot token and Chat ID verified successfully.`,
        { parse_mode: 'HTML' }
      );

      res.json({ success: true, message: 'Test message sent successfully!' });
    } catch (err) {
      res.status(500).json({ error: `Test failed: ${err.message}` });
    }
  });

  app.patch('/api/categories/:id/toggle', (req, res) => {
    try {
      const { is_active } = req.body;
      database.toggleCategory(req.params.id, is_active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Telegram User Auth APIs ──────────────────────────────────────────────
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

  // ─── Session Cookies Manager APIs ─────────────────────────────────────────
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

  // 2. Seed default CC and Deals categories from env vars
  database.seedDefaultCategories(
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID,
    process.env.DEALS_BOT_TOKEN || null,
    process.env.TELEGRAM_CHAT_ID
  );

  // 3. Initialize unified fallback summarization engine
  const summarizer = new Summarizer(process.env.GEMINI_API_KEY, process.env.OPENROUTER_API_KEY);

  // 4. Create bot instances for ALL active categories
  const botInstances = createBotInstances(database, summarizer);

  // Central Session Alert Dispatcher (routes to primary CC Telegram Bot)
  const sendSystemAlert = async (message) => {
    logger.warn(`🚨 [System Alert] ${message}`);
    const ccBotInstance = botInstances.get('cc');
    if (ccBotInstance) {
      try {
        await ccBotInstance.sendMessage(`🚨 <b>Session Alert</b>\n\n${message}`);
      } catch (err) {
        logger.error(`Failed to send Telegram system alert: ${err.message}`);
      }
    }
  };

  // 5. Initialize active ingestion observers
  const whatsapp = new WhatsAppListener(database, sendSystemAlert);
  const telegramUser = new TelegramUserListener(database, sendSystemAlert);
  const scheduler = new Scheduler(summarizer, botInstances, database);

  // 6. Initialize lightweight scrapers (Puppeteer-free)
  const ccBot = botInstances.get('cc');
  const forumScraper = new ForumScraper(database, sendSystemAlert);
  const dealsScraper = new DealsScraper(database, sendSystemAlert);
  const redditScraper = new RedditScraper(database, sendSystemAlert);
  const youtubeScraper = new YoutubeScraper(database, summarizer);

  // 7. Start Express server immediately to let Coolify healthchecks pass
  const healthServer = startDashboardServer(database, whatsapp, telegramUser, scheduler, summarizer, botInstances);

  // 8. Start all bot instances
  for (const [slug, bot] of botInstances) {
    const connected = await bot.start();
    if (!connected) {
      logger.warn(`⚠️ Telegram Bot for category "${slug}" failed to connect.`);
      // Only exit for the primary CC bot
      if (slug === 'cc') {
        logger.error('Cannot connect to Main CC Telegram Bot. Verify your TELEGRAM_BOT_TOKEN.');
        process.exit(1);
      }
    }
  }

  // 9. Bootstrap background listeners and schedules (non-blocking)
  whatsapp.start().catch(err => logger.error(`WhatsApp listener failed: ${err.message}`));
  telegramUser.start().catch(err => logger.error(`Telegram user listener failed: ${err.message}`));
  scheduler.start();
  
  forumScraper.start();
  dealsScraper.start();
  redditScraper.start();
  youtubeScraper.start();

  // Send startup notifications for all bots
  for (const [slug, bot] of botInstances) {
    try {
      if (slug === 'cc') {
        await bot.sendStartupNotification();
      } else {
        const cat = database.getCategoryBySlug(slug);
        const displayName = cat ? cat.display_name : slug.toUpperCase();
        await bot.sendMessage(`🟢 <b>${displayName} Brief Agent Started</b>\nAll scrapers operational.`);
      }
    } catch (err) {
      logger.warn(`Failed to send startup notification for "${slug}": ${err.message}`);
    }
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
    
    for (const [slug, bot] of botInstances) {
      try {
        await bot.stop();
      } catch (e) { /* ignore */ }
    }

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
