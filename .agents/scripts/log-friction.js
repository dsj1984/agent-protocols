import fs from 'fs';

const args = process.argv.slice(2);
const logFile = args[0];
const type = args[1];
const tool = args[2];
const errorMessage = args[3];

if (!logFile || !type || !tool || !errorMessage) {
  console.error(
    'Usage: node log-friction.js <path-to-json> <type> <tool> <error-message>'
  );
  process.exit(1);
}

const entry = {
  timestamp: new Date().toISOString(),
  type,
  tool,
  error: errorMessage,
};

try {
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
} catch (err) {
  console.error(`Failed to write friction log to ${logFile}: ${err.message}`);
  process.exit(1);
}
