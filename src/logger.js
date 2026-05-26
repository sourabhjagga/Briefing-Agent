const fs = require('fs');
const path = require('path');

const logFilePath = path.resolve(__dirname, '../logs/agent.log');

// Helper to format timestamps
function getTimestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// Ensure logs directory exists
const dir = path.dirname(logFilePath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeToFile(level, message) {
  const line = `[${getTimestamp()}] [${level}] ${message}\n`;
  fs.appendFileSync(logFilePath, line, 'utf8');
}

const logger = {
  info: (msg) => {
    const formatted = `\x1b[32m[INFO]\x1b[0m ${msg}`;
    console.log(`${getTimestamp()} ${formatted}`);
    writeToFile('INFO', msg);
  },
  warn: (msg) => {
    const formatted = `\x1b[33m[WARN]\x1b[0m ${msg}`;
    console.warn(`${getTimestamp()} ${formatted}`);
    writeToFile('WARN', msg);
  },
  error: (msg) => {
    const formatted = `\x1b[31m[ERROR]\x1b[0m ${msg}`;
    console.error(`${getTimestamp()} ${formatted}`);
    writeToFile('ERROR', msg);
  },
  debug: (msg) => {
    if (process.env.NODE_ENV !== 'production') {
      const formatted = `\x1b[36m[DEBUG]\x1b[0m ${msg}`;
      console.log(`${getTimestamp()} ${formatted}`);
      writeToFile('DEBUG', msg);
    }
  }
};

module.exports = logger;
