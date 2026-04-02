import { describe, it, after } from 'node:test';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('diagnose-friction.js', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friction-test-'));

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends friction log with --task parameter', () => {
    try {
      // Execute a command that will intentionally fail
      execSync(`node .agents/scripts/diagnose-friction.js --sprint "${tmpDir}" --task 123.4 --cmd "node -e \\"process.exit(1)\\""`, { stdio: 'pipe' });
    } catch (e) {
      // It is expected to throw because the inner command fails
    }

    const logPath = path.join(tmpDir, 'agent-friction-log.json');
    assert.ok(fs.existsSync(logPath), 'Friction log file should be created');

    const content = fs.readFileSync(logPath, 'utf8').trim();
    const records = content.split('\n').map(l => JSON.parse(l));
    const lastRecord = records[records.length - 1];

    assert.equal(lastRecord.task, '123.4', 'The task ID should be correctly parsed and included in the log');
    assert.equal(lastRecord.type, 'friction_point');
  });
});
