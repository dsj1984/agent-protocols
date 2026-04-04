import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { resolveConfig } from './lib/config-resolver.js';import { Logger } from "./lib/Logger.js";


/**
 * Standard utility to update the decoupled JSON state for an agent task.
 * Usage: node update-task-state.js <task-id> <status>
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const taskId = process.argv[2];
const status = process.argv[3];

if (!taskId || !status) {
  Logger.fatal('Usage: node update-task-state.js <task-id> <status>');
  
}

// 1. Resolve taskStateRoot via unified config resolver
const { settings: agentConfig } = resolveConfig();
let taskStateRoot = agentConfig.taskStateRoot ?? 'temp/task-state';
let keysRoot = agentConfig.keysRoot ?? '.agents/keys';
let scriptsRoot = agentConfig.scriptsRoot ?? '.agents/scripts';

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
    const keyPath = path.join(PROJECT_ROOT, keysRoot, 'private.pem');

    if (fs.existsSync(keyPath)) {
      try { fs.chmodSync(keyPath, 0o600); } catch(e) {} // Explicitly enforce isolate permissions
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
       const apcScriptPath = path.join(PROJECT_ROOT, scriptsRoot, 'extract-intent.js');
       if (fs.existsSync(apcScriptPath)) {
         execFileSync('node', [apcScriptPath, '000', taskId], { stdio: 'inherit' });
       }
    } catch (apcErr) {
       console.warn(`⚠️ [APC] Intent extraction failed for ${taskId}:`, apcErr.message);
    }
  }
} catch (err) {
  Logger.fatal(`❌ Failed to update state for task ${taskId}:`, err.message);
  
}
