import fs from 'node:fs';
import path from 'node:path';

/**
 * Standard utility to update the decoupled JSON state for an agent task.
 * Usage: node update-task-state.js <task-id> <status>
 */

const taskId = process.argv[2];
const status = process.argv[3];
const configPath = path.resolve(process.cwd(), '.agents/config/config.json');

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
} catch (err) {
  console.error(`❌ Failed to update state for task ${taskId}:`, err.message);
  process.exit(1);
}
