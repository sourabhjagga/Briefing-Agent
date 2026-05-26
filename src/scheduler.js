/**
 * Scheduler Module
 * Runs scheduled briefings at 6:00 AM, 2:00 PM, and 10:00 PM IST (Asia/Kolkata timezone).
 * Staggers CC and Deals briefs by 30 seconds to avoid AI API quota conflicts.
 */

const cron = require('node-cron');
const logger = require('./logger');

class Scheduler {
  constructor(summarizer, telegramCC, telegramDeals, database) {
    this.summarizer = summarizer;
    this.telegramCC = telegramCC;
    this.telegramDeals = telegramDeals;
    this.database = database;
    this.jobs = [];
  }

  start() {
    const schedules = [
      { time: '0 6 * * *', label: 'Morning' },
      { time: '0 14 * * *', label: 'Mid-day' },
      { time: '0 22 * * *', label: 'Nightly' }
    ];

    schedules.forEach(s => {
      // Schedule the briefing job
      const job = cron.schedule(s.time, async () => {
        logger.info(`📅 Scheduled ${s.label} briefing job triggered.`);
        
        // 1. Run Credit Cards Summary immediately
        await this._runSummaryJob('cc', this.telegramCC);
        
        // 2. Stagger Deals Summary by 30 seconds to prevent concurrent model quota collisions
        if (this.telegramDeals) {
          logger.info('⏳ Staggering Deals briefing job by 30 seconds...');
          setTimeout(async () => {
            await this._runSummaryJob('deals', this.telegramDeals);
          }, 30000);
        }
      }, {
        timezone: 'Asia/Kolkata',
      });
      
      this.jobs.push(job);
    });

    logger.info('📅 Briefing schedules armed: 6:00 AM, 2:00 PM, and 10:00 PM IST.');

    // 3. Schedule daily database cleanup at 3:00 AM IST to purge messages older than 30 days
    const cleanupJob = cron.schedule('0 3 * * *', () => {
      logger.info('🧹 Running daily SQLite database cleanup...');
      this.database.cleanup();
    }, {
      timezone: 'Asia/Kolkata',
    });
    this.jobs.push(cleanupJob);
  }

  async _runSummaryJob(sourcePrefix, telegramInstance) {
    logger.info(`=== STARTING ${sourcePrefix.toUpperCase()} BRIEFING GENERATION ===`);
    const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

    try {
      const messages = this.database.getTodayMessages(sourcePrefix);
      logger.info(`[${sourcePrefix}] Found ${messages.length} messages for today's brief.`);

      if (messages.length === 0) {
        logger.info(`[${sourcePrefix}] Skipping brief because 0 messages were captured today.`);
        await telegramInstance.sendMessage(`🤷‍♂️ <b>No updates today!</b>\n\nThere were no messages captured from your monitored ${sourcePrefix.toUpperCase()} sources today.`);
        return;
      }

      const groups = this.database.getTodayActiveGroups(sourcePrefix);
      logger.info(`[${sourcePrefix}] Active groups: ${groups.map(g => `${g.group_name}(${g.count})`).join(', ')}`);

      let customPrompt = undefined;
      if (sourcePrefix === 'deals') {
        customPrompt = "You are a shopping deals expert. Summarize the best deals from the provided messages. Mention the product, the deal price or discount, and any links. Organize it by categories (e.g., Electronics, Fashion, Travel). Keep it exciting and brief!";
      }

      const summary = await this.summarizer.generateSummary(messages, customPrompt);

      let finalSummary = summary;
      if (sourcePrefix === 'cc') {
        finalSummary += "\n\n<i>This brief is from the new clean application.</i>";
      }

      const sent = await telegramInstance.sendMessage(finalSummary);

      // Save summary and brief logs to SQLite for history retrieval
      if (sourcePrefix === 'cc') {
        this.database.saveSummary(today, messages.length, finalSummary, sent);
        this.database.saveBrief(today, finalSummary, messages.length);
      }

      logger.info(`=== ${sourcePrefix.toUpperCase()} BRIEFING COMPLETED ===`);
    } catch (error) {
      logger.error(`[${sourcePrefix}] Briefing generation failed: ${error.message}`);
      try {
        await telegramInstance.sendMessage(
          `⚠️ <b>Briefing Error</b>\n\nFailed to generate today's ${sourcePrefix.toUpperCase()} summary.\nError: ${error.message}`
        );
      } catch (e) {
        logger.error(`Could not dispatch error notification: ${e.message}`);
      }
    }
  }

  async triggerNow() {
    logger.info('⚡ Manual summary trigger requested across all profiles.');
    await this._runSummaryJob('cc', this.telegramCC);
    if (this.telegramDeals) {
      // Stagger deals trigger also by 30 seconds
      setTimeout(async () => {
        await this._runSummaryJob('deals', this.telegramDeals);
      }, 30000);
    }
  }

  stop() {
    logger.info('Stopping all scheduler cron jobs...');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    logger.info('Scheduler successfully stopped.');
  }
}

module.exports = Scheduler;
