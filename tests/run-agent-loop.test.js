import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '../.agents/scripts/run-agent-loop.js');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STREAM_DIR = path.join(PROJECT_ROOT, 'temp/event-streams');

describe('run-agent-loop.js integration', () => {
  it('receives ConcludeTask JSON via stdin and appends to event stream ledger', () => {
    const taskId = 'test-integration-task';
    const ledgerPath = path.join(STREAM_DIR, `${taskId}.jsonl`);

    // Ensure clean state before running
    if (fs.existsSync(ledgerPath)) {
      fs.unlinkSync(ledgerPath);
    }

    const payload = JSON.stringify({ action: 'ConcludeTask', reasoning: 'Done', parameters: {} });

    // Spawn script and feed payload via stdin
    const child = spawnSync('node', [SCRIPT_PATH, taskId], {
      input: payload + '\n',
      encoding: 'utf8',
      env: { ...process.env, CI: '1' }
    });

    assert.equal(child.status, 0, `Script exited with status ${child.status}\nStderr: ${child.stderr}`);
    
    assert.ok(fs.existsSync(ledgerPath), `Ledger file not created at ${ledgerPath}`);
    
    const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 2, 'Should have System init and AgentAction log');
    
    const initAction = JSON.parse(lines[0]);
    assert.equal(initAction.type, 'System');
    
    // Check if the AgentAction is recorded
    const agentActionStr = lines.find(l => {
      try {
        const obj = JSON.parse(l);
        return obj.type === 'AgentAction' && obj.data?.action === 'ConcludeTask';
      } catch {
        return false;
      }
    });
    
    assert.ok(agentActionStr, 'Ledger should contain the AgentAction ConcludeTask entry');

    // Clean up
    fs.unlinkSync(ledgerPath);
  });
});
