import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: node run-agent-loop.js <task-id>');
  process.exit(1);
}

const STREAM_DIR = path.join(PROJECT_ROOT, 'temp/event-streams');
if (!fs.existsSync(STREAM_DIR)) fs.mkdirSync(STREAM_DIR, { recursive: true });

const ledgerPath = path.join(STREAM_DIR, `${taskId}.jsonl`);

function appendEvent(event) {
  event.timestamp = new Date().toISOString();
  fs.appendFileSync(ledgerPath, JSON.stringify(event) + '\n', 'utf8');
}

// Initialize ledger if empty
if (!fs.existsSync(ledgerPath)) {
  appendEvent({ type: 'System', message: `Initialized Perception-Action Ledger for Task: ${taskId}` });
  console.log(`[System] Initialized new event ledger at ${ledgerPath}`);
}

console.log(`[Event Stream Active] Awaiting JSON action payloads via stdin. To exit, emit 'ConcludeTask'.`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  
  let action;
  try {
    action = JSON.parse(line);
  } catch (e) {
    console.error(JSON.stringify({ error: "Invalid JSON format", detail: e.message }));
    return;
  }

  if (!action.action || !action.reasoning) {
    console.error(JSON.stringify({ error: "Missing required fields 'action' or 'reasoning'" }));
    return;
  }

  appendEvent({ type: 'AgentAction', data: action });

  try {
    let result = null;
    switch (action.action) {
      case 'ReadFile':
        const targetPath = path.join(PROJECT_ROOT, action.path);
        if (fs.existsSync(targetPath)) {
          result = fs.readFileSync(targetPath, 'utf8');
        } else {
          throw new Error(`File not found: ${action.path}`);
        }
        break;

      case 'WriteFile':
        const writePath = path.join(PROJECT_ROOT, action.path);
        fs.mkdirSync(path.dirname(writePath), { recursive: true });
        fs.writeFileSync(writePath, action.content, 'utf8');
        result = `Successfully wrote ${action.path}`;
        break;

      case 'ExecuteSafeCommand':
        result = execSync(action.command, { cwd: PROJECT_ROOT, stdio: 'pipe' }).toString();
        break;

      case 'ConcludeTask':
        console.log(JSON.stringify({ status: "Task Concluded", finalState: action.status }));
        appendEvent({ type: 'System', message: `Task Concluded with state: ${action.status}` });
        process.exit(0);

      default:
        throw new Error(`Unknown action type: ${action.action}`);
    }

    const observation = { type: 'EnvironmentObservation', result: result };
    appendEvent(observation);
    console.log(JSON.stringify(observation));

  } catch (err) {
    const errorObservation = { type: 'EnvironmentError', message: err.message };
    appendEvent(errorObservation);
    console.log(JSON.stringify(errorObservation));
  }
});
