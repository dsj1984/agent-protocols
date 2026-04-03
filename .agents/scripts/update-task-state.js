import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

/**
 * Standard utility to update the decoupled JSON state for an agent task.
 * Usage: node update-task-state.js <task-id> <status>
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const configPath = path.join(PROJECT_ROOT, '.agents/config/config.json');

const taskId = process.argv[2];
const status = process.argv[3];

if (!taskId || !status) {
  console.error('Usage: node update-task-state.js <task-id> <status>');
  process.exit(1);
}

// 1. Resolve taskStateRoot from config.json
let taskStateRoot = 'temp/task-state';
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config?.properties?.taskStateRoot?.default) {
      taskStateRoot = config.properties.taskStateRoot.default;
    }
  } catch (err) {
    console.warn(`Could not parse config.json, using default: ${taskStateRoot}`);
  }
}

// 2. Ensure state directory exists
const stateDir = path.resolve(process.cwd(), taskStateRoot);
if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir, { recursive: true });
}

// 3. Write or update the state file
const stateFilePath = path.join(stateDir, `${taskId}.json`);
const stateObject = {
  status: status,
  timestamp: new Date().toISOString(),
};

try {
  fs.writeFileSync(stateFilePath, JSON.stringify(stateObject, null, 2));
  console.log(`✅ Task ${taskId} marked as ${status} in ${stateFilePath}`);
  
  // Conditionally generate test receipt if requested or if status is 'passed'
  // Support both normal states and test receipts from the same script
  if (status === 'passed') {
    const receiptPath = path.join(stateDir, `${taskId}-test-receipt.json`);
    const receiptObject = {
      status: 'passed',
      timestamp: new Date().toISOString(),
      task: taskId
    };

    let finalPayload = receiptObject;
    const keyPath = path.join(PROJECT_ROOT, '.agents/keys/private.pem');

    if (fs.existsSync(keyPath)) {
      const privateKey = fs.readFileSync(keyPath, 'utf8');
      const payloadStr = JSON.stringify(receiptObject);
      const signature = crypto.sign(null, Buffer.from(payloadStr), privateKey).toString('base64');
      finalPayload = { payload: receiptObject, signature };
    }

    fs.writeFileSync(receiptPath, JSON.stringify(finalPayload, null, 2));
    console.log(`✅ Test receipt generated at ${receiptPath}${finalPayload.signature ? ' (Cryptographically Signed)' : ''}`);
    
    // [APC Hook] Asynchronously extract and cache intent memory for future runs
    // Resolve sprint number from task-state directory context or default to latest
    try {
       console.log(`[APC] Initiating Speculative Intent Extraction for ${taskId}...`);
       // We pass a mock sprint 'latest' since update-task-state usually doesn't have the sprint arg natively.
       // The extraction logic defaults to the latest sprint if argument isn't an exact match.
       const apcScriptPath = path.join(__dirname, 'extract-intent.js');
       if (fs.existsSync(apcScriptPath)) {
         execSync(`node ${apcScriptPath} 000 ${taskId}`, { stdio: 'inherit' });
       }
    } catch (apcErr) {
       console.warn(`⚠️ [APC] Intent extraction failed for ${taskId}:`, apcErr.message);
    }
  }
} catch (err) {
  console.error(`❌ Failed to update state for task ${taskId}:`, err.message);
  process.exit(1);
}
