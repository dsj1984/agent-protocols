import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { vol } from 'memfs';
import { setupFsMock } from '../lib/fs-mock.js';
import { AgentLoopRunner } from '../../.agents/scripts/lib/AgentLoopRunner.js';
import fs from 'node:fs';

/** Flush the microtask + one macrotask tick so async readline IIFEs can settle. */
function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('run-agent-loop E2E (memfs)', () => {
  let originalExit;
  let originalConsoleLog;
  let logs = [];

  beforeEach((t) => {
    vol.reset();
    logs = [];

    // Mock process.exit to prevent the test runner from dying
    originalExit = process.exit;
    process.exit = (code) => {
      logs.push(`ProcessExitedWithCode${code}`);
    };

    // Capture console.log to suppress output and allow assertion
    originalConsoleLog = console.log;
    console.log = (msg) => logs.push(msg);

    // Completely stub FS
    setupFsMock(t, vol);
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
  });

  it('runs dispatcher via stdin and records full transaction ledger', async () => {
    // Scaffold initial state
    vol.fromJSON({
      'playbook.md': '# Sprint 001\n',
      'temp/event-streams': null // Create dir but empty
    }, '/mock-repo');

    const runner = new AgentLoopRunner({
      taskId: 'e2e-task-1',
      projectRoot: '/mock-repo',
      workspacesDir: '/mock-repo/temp/workspaces',
      streamDir: '/mock-repo/temp/event-streams',
    });

    const mockStdin = new PassThrough();

    // Start runner (it will sit idle listening to mockStdin)
    runner.start(mockStdin);

    // Dispatch ReadFile
    mockStdin.write(JSON.stringify({
      action: 'ReadFile',
      reasoning: 'Reading playbook',
      path: 'playbook.md'
    }) + '\n');

    // Dispatch WriteFile
    mockStdin.write(JSON.stringify({
      action: 'WriteFile',
      reasoning: 'Creating test artifact',
      path: 'artifact.txt',
      content: 'Hello E2E'
    }) + '\n');

    // Dispatch ConcludeTask
    mockStdin.write(JSON.stringify({
      action: 'ConcludeTask',
      reasoning: 'Finished',
      status: 'done'
    }) + '\n');

    // Allow async dispatch IIFEs to drain before asserting
    await flushAsync();

    // Validate memory FS state updates properly
    assert.equal(vol.readFileSync('/mock-repo/artifact.txt', 'utf8'), 'Hello E2E');

    // The ledger file has been written
    const ledgerOutput = vol.readFileSync('/mock-repo/temp/event-streams/e2e-task-1.jsonl', 'utf8');
    assert.ok(ledgerOutput.includes('"type":"System"'));
    assert.ok(ledgerOutput.includes('"action":"ReadFile"'));
    assert.ok(ledgerOutput.includes('"action":"WriteFile"'));
    assert.ok(ledgerOutput.includes('"action":"ConcludeTask"'));
  });
});
