/**
 * Telegram Bot Module
 * Pushes briefings and handles interactive bot commands (/brief, /ask, /search, etc.) via Telegraf.
 * Implements a compiler-grade single-pass tag balancer stack and robust HTML-safety chunking.
 */

const { Telegraf } = require('telegraf');
const logger = require('./logger');

// Escape helper to prevent Telegram HTML parse failures
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class TelegramBotDispatcher {
  constructor(botToken, chatId, database, summarizer, sourcePrefix = 'cc', customPrompt = undefined) {
    if (!botToken) throw new Error('Telegram bot token required. Set TELEGRAM_BOT_TOKEN in .env');
    if (!chatId) throw new Error('Telegram chat ID required. Set TELEGRAM_CHAT_ID in .env');

    this.chatId = chatId;
    this.database = database;
    this.summarizer = summarizer;
    this.sourcePrefix = sourcePrefix;
    this.customPrompt = customPrompt;
    
    // Enable interactive polling only if database & summarizer are provided
    this.interactive = !!(database && summarizer);
    this.bot = new Telegraf(botToken);

    if (this.interactive) {
      this._setupCommands();
    }
  }

  async start() {
    try {
      if (this.interactive) {
        logger.info(`📱 Starting Telegram Bot polling for @${this.sourcePrefix.toUpperCase()} Agent...`);
        this.bot.launch().catch(err => {
          logger.error(`Telegraf bot launch error: ${err.message}`);
        });
      }
      const botInfo = await this.bot.telegram.getMe();
      logger.info(`✅ Telegram Bot verified: @${botInfo.username}`);
      return true;
    } catch (err) {
      logger.error(`Telegram startup verification failed: ${err.message}`);
      return false;
    }
  }

  _setupCommands() {
    // Guard middleware to ensure only the owner chat can trigger commands
    this.bot.use(async (ctx, next) => {
      const currentChatId = String(ctx.chat?.id);
      if (currentChatId !== String(this.chatId)) {
        logger.warn(`🔒 Unauthorized bot access attempt from Chat ID: ${currentChatId}`);
        return;
      }
      await next();
    });

    // /start & /help
    this.bot.command(['start', 'help'], async (ctx) => {
      await ctx.replyWithHTML(
        `🤖 <b>${this.sourcePrefix === 'cc' ? 'Credit Card' : 'Hot Deals'} Briefing Bot</b>\n\n` +
        `/brief — Generate today's summary now\n` +
        `/status — Show agent status &amp; active groups\n` +
        `/groups — List all monitored groups/channels\n` +
        `/ask &lt;question&gt; — Ask AI about credit cards/deals\n` +
        `/search &lt;keyword&gt; — Search past messages\n` +
        `/stats — View 7-day statistics\n` +
        `/total — Total messages stored in DB\n` +
        `/test — Verify latest message from all sources\n` +
        `/help — Show this help manual\n\n` +
        `<i>Briefings are sent automatically at 6 AM, 2 PM &amp; 10 PM IST</i>`
      );
    });

    // /brief
    this.bot.command('brief', async (ctx) => {
      await ctx.reply('⏳ Generating today\'s brief from all monitored groups. Please wait...');
      try {
        const messages = this.database.getTodayMessages(this.sourcePrefix);
        if (messages.length === 0) {
          await ctx.replyWithHTML('📭 <b>No messages collected today yet.</b>\n\nMake sure your WhatsApp/Telegram groups are active.');
          return;
        }
        const summary = await this.summarizer.generateSummary(messages, this.customPrompt);
        await this.sendMessage(summary);
      } catch (err) {
        logger.error(`/brief error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error generating brief:</b> ${esc(err.message)}`);
      }
    });

    // /ask <query>
    this.bot.hears(/^\/ask\s+(.+)$/i, async (ctx) => {
      const question = ctx.match[1];
      await ctx.reply('🔍 Searching and analyzing message repository...');
      try {
        const keywords = question.split(/\s+/).filter(w => w.length > 3);
        let allMessages = [];
        for (const kw of keywords) {
          const msgs = this.database.searchMessages(kw, 15, this.sourcePrefix);
          allMessages.push(...msgs);
        }
        
        // Deduplicate messages
        const seen = new Set();
        allMessages = allMessages.filter(m => {
          const key = `${m.timestamp}-${m.body?.substring(0, 50)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const answer = await this.summarizer.answerQuestion(question, allMessages);
        await this.sendMessage(`💡 <b>Answer</b>\n\n${answer}\n\n<i>Based on ${allMessages.length} relevant historical messages</i>`);
      } catch (err) {
        logger.error(`/ask error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });

    // /search <keyword>
    this.bot.hears(/^\/search\s+(.+)$/i, async (ctx) => {
      const keyword = ctx.match[1];
      try {
        const results = this.database.searchMessages(keyword, 10, this.sourcePrefix);
        if (results.length === 0) {
          await ctx.replyWithHTML(`🔍 No messages found matching: <b>${esc(keyword)}</b>`);
          return;
        }

        let response = `🔍 <b>Search: "${esc(keyword)}"</b> (${results.length} results)\n\n`;
        for (const r of results) {
          const date = new Date(r.timestamp * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
          const snippet = (r.body || '').substring(0, 150);
          response += `📅 ${date} | <b>${esc(r.group_name)}</b>\n${esc(snippet)}\n\n`;
        }
        await this.sendMessage(response);
      } catch (err) {
        logger.error(`/search error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });

    // /stats
    this.bot.command('stats', async (ctx) => {
      try {
        const stats = this.database.getStats(7, this.sourcePrefix);
        const today = this.database.getTodayMessageCount(this.sourcePrefix);
        let response = `📊 <b>7-Day Statistics</b>\n\nTotal messages: <b>${stats.totalMessages}</b>\nToday: <b>${today}</b>\n\n<b>By Source:</b>\n`;
        for (const g of stats.byGroup) {
          const icon = g.chat_type === 'channel' ? '📢' : g.chat_type === 'forum' ? '🌐' : '👥';
          response += `${icon} ${esc(g.group_name)}: <b>${g.count}</b>\n`;
        }
        await ctx.replyWithHTML(response);
      } catch (err) {
        logger.error(`/stats error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });

    // /groups
    this.bot.command('groups', async (ctx) => {
      try {
        const allSources = this.database.getAllSources().filter(s => s.type.startsWith(this.sourcePrefix + '-'));
        if (allSources.length === 0) {
          await ctx.reply('ℹ️ No target sources configured for this agent.');
          return;
        }

        const activeToday = new Set(
          this.database.getTodayActiveGroups(this.sourcePrefix).map(g => (g.group_id || '').toLowerCase())
        );

        let response = `🔍 <b>Monitored Sources</b> — ${allSources.length} configured\n`;
        response += `<i>✅ = active today  ⏳ = waiting for post</i>\n\n`;

        for (const s of allSources) {
          const isActive = activeToday.has(s.source_id.toLowerCase());
          const statusIcon = isActive ? '✅' : '⏳';
          let icon = '👥';
          if (s.type.includes('forum')) icon = '🌐';
          if (s.type.includes('telegram')) icon = '📢';
          if (s.type.includes('reddit')) icon = '👽';
          if (s.type.includes('youtube')) icon = '🎥';

          response += `${statusIcon} ${icon} ${esc(s.name)}\n<code>${s.source_id}</code>\n\n`;
        }

        const activeCount = allSources.filter(s => activeToday.has(s.source_id.toLowerCase())).length;
        response += `📊 <b>${activeCount}/${allSources.length}</b> sources active today.`;
        
        await this.sendMessage(response);
      } catch (err) {
        logger.error(`/groups error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });

    // /status
    this.bot.command('status', async (ctx) => {
      try {
        const today = this.database.getTodayMessageCount(this.sourcePrefix);
        const activeGroups = this.database.getTodayActiveGroups(this.sourcePrefix);
        const allSources = this.database.getAllSources().filter(s => s.is_active === 1 && s.type.startsWith(this.sourcePrefix + '-'));

        let response = `🟢 <b>Agent Active & Running</b>\n\n`;
        response += `📨 Messages collected today: <b>${today}</b>\n`;
        response += `👥 Active sources today: <b>${activeGroups.length}</b>/${allSources.length}\n\n`;

        if (activeGroups.length > 0) {
          response += `<b>Active Today:</b>\n`;
          for (const g of activeGroups) {
            const icon = g.chat_type === 'channel' ? '📢' : g.chat_type === 'forum' ? '🌐' : '👥';
            response += `${icon} ${esc(g.group_name)}: ${g.count} msgs\n`;
          }
        } else {
          response += `⚠️ No messages captured yet today. Monitoring active...`;
        }

        await ctx.replyWithHTML(response);
      } catch (err) {
        logger.error(`/status error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });

    // /total
    this.bot.command('total', async (ctx) => {
      try {
        const stats = this.database.getStats(365, this.sourcePrefix);
        const todayCount = this.database.getTodayMessageCount(this.sourcePrefix);
        await ctx.replyWithHTML(
          `📊 <b>Database Stats</b>\n\n` +
          `Total messages stored: <b>${stats.totalMessages}</b>\n` +
          `Messages collected today: <b>${todayCount}</b>\n\n` +
          `<i>Note: Database automatically cleans up logs older than 30 days.</i>`
        );
      } catch (err) {
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });

    // /test
    this.bot.command('test', async (ctx) => {
      await ctx.reply('⏳ Requesting latest message verification status across all sources...');
      try {
        const allSources = this.database.getAllSources().filter(s => s.is_active === 1 && s.type.startsWith(this.sourcePrefix + '-'));
        if (allSources.length === 0) {
          await ctx.reply('ℹ️ No active sources configured for verification.');
          return;
        }

        let report = `🔍 <b>Source Verification Status</b>\n`;
        report += `<i>Checking latest captured post in SQLite from each source...</i>\n\n`;

        for (const s of allSources) {
          const cleanName = s.name.replace(/\s*\(Telegram\)|\s*\(Reddit\)|\s*\(YouTube\)|\s*Recent Posts|\s*VIP Lounge|\s*Credit Cards Hub/gi, '').trim().toLowerCase();
          const cleanSourceId = s.source_id.trim().replace('@', '').toLowerCase();

          const lastMsg = this.database.db.prepare(`
            SELECT body, timestamp, sender_name
            FROM messages
            WHERE source_type = ? 
              AND (
                LOWER(group_name) LIKE ? 
                OR LOWER(group_id) = ? 
                OR LOWER(group_id) LIKE ?
                OR LOWER(message_id) LIKE ?
              )
            ORDER BY timestamp DESC
            LIMIT 1
          `).get(
            s.type, 
            `%${cleanName}%`, 
            cleanSourceId, 
            `%${cleanSourceId}%`,
            `%${cleanSourceId}%`
          );

          let icon = '👥';
          if (s.type.includes('forum')) icon = '🌐';
          if (s.type.includes('telegram')) icon = '📢';
          if (s.type.includes('reddit')) icon = '👽';
          if (s.type.includes('youtube')) icon = '🎥';

          report += `${icon} <b>${esc(s.name)}</b>\n`;

          if (lastMsg) {
            const time = new Date(lastMsg.timestamp * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
            const date = new Date(lastMsg.timestamp * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
            const cleanBody = (lastMsg.body || '').replace(/<[^>]*>/g, '');
            const snippet = cleanBody.substring(0, 120);
            report += `📅 ${date} | 🕘 ${time} | 👤 ${esc(lastMsg.sender_name || 'System')}\n`;
            report += `<code>${esc(snippet)}${cleanBody.length > 120 ? '...' : ''}</code>\n\n`;
          } else {
            report += `⚠️ <i>No messages captured yet in database. (Waiting for new posts)</i>\n\n`;
          }
        }

        await this.sendMessage(report);
      } catch (err) {
        logger.error(`/test error: ${err.message}`);
        await ctx.replyWithHTML(`⚠️ <b>Error:</b> ${esc(err.message)}`);
      }
    });
  }

  async sendMessage(text) {
    try {
      const chunks = this._splitMessage(text, 4000);
      for (const chunk of chunks) {
        await this.bot.telegram.sendMessage(this.chatId, chunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
        // 800ms throttle buffer between multi-part messages to respect flood limits
        if (chunks.length > 1) {
          await new Promise(r => setTimeout(r, 800));
        }
      }
      logger.info(`✅ Dispatched Telegram message summary successfully (${chunks.length} parts).`);
      return true;
    } catch (error) {
      logger.error(`Failed to dispatch Telegram message: ${error.message}`);
      // Fallback to pure text strip if HTML is corrupted
      try {
        const plain = text.replace(/<[^>]*>/g, '');
        await this.bot.telegram.sendMessage(this.chatId, plain);
        logger.info('✅ Dispatched Telegram message via plain text fallback successfully.');
        return true;
      } catch (fallbackErr) {
        logger.error(`Telegram plain text fallback also failed: ${fallbackErr.message}`);
      }
      return false;
    }
  }

  async sendStartupNotification() {
    const today = new Date().toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    const allSources = this.database.getAllSources().filter(s => s.is_active === 1 && s.type.startsWith(this.sourcePrefix + '-'));
    
    const msg =
      `🟢 <b>${this.sourcePrefix === 'cc' ? 'CC' : 'Hot Deals'} Brief Agent Started</b>\n\n` +
      `📱 Monitoring <b>${allSources.length}</b> active sources\n` +
      `🌐 All scrapers fully operational (Puppeteer-free)\n` +
      `⏰ Scheduled briefings: 6 AM, 2 PM &amp; 10 PM IST\n\n` +
      `📅 ${today} | 🕘 ${time}\n\n` +
      `Type /help to see commands or /status to inspect active groups.`;
    return this.sendMessage(msg);
  }

  _splitMessage(text, maxLen = 4000) {
    if (text.length <= maxLen) return [text];
    
    const chunks = [];
    // Split by major paragraph sections starting with icons
    const paragraphs = text.split(/\n+(?=(?:🚀|💡|🔓|📊|🤖|🎥|🔥|💰|📝|🔗|📅|📌))/);
    
    let currentChunk = '';
    for (const para of paragraphs) {
      if ((currentChunk + para).length > maxLen) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        // Handle giant paragraphs (split strictly by lines)
        if (para.length > maxLen) {
          const lines = para.split('\n');
          for (const line of lines) {
            if ((currentChunk + '\n' + line).length > maxLen) {
              chunks.push(currentChunk.trim());
              currentChunk = line;
            } else {
              currentChunk = currentChunk ? currentChunk + '\n' + line : line;
            }
          }
        } else {
          currentChunk = para;
        }
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.map(chunk => this._balanceTags(chunk));
  }

  _balanceTags(html) {
    const regex = /<\/?([a-zA-Z0-9]+)\b[^>]*>/g;
    let match;
    const stack = [];
    const safeTags = ['b', 'i', 'code', 'u', 's', 'a'];

    while ((match = regex.exec(html)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();
      
      if (!safeTags.includes(tagName)) continue;

      const isClose = fullTag.startsWith('</');
      if (isClose) {
        if (stack.length > 0 && stack[stack.length - 1] === tagName) {
          stack.pop();
        }
      } else {
        stack.push(tagName);
      }
    }

    let balanced = html;
    // Close any tags left open at the end
    while (stack.length > 0) {
      const tagName = stack.pop();
      balanced += `</${tagName}>`;
    }
    return balanced;
  }

  async stop() {
    this.bot.stop();
    logger.info('Telegram Bot dispatcher stopped.');
  }
}

module.exports = TelegramBotDispatcher;
