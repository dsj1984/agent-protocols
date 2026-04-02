import { describe, it, beforeEach, afterEach } from 'node:test';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('harvest-golden-path.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips harvesting if friction log indicates friction for the task', () => {
    // Create a friction log for task 123
    const logPath = path.join(tmpDir, 'agent-friction-log.json');
    fs.writeFileSync(logPath, JSON.stringify({ task: '123', type: 'friction_point' }) + '\n');
    
    // Execute the harvest script
    const output = execSync(`node .agents/scripts/harvest-golden-path.js --sprint "${tmpDir}" --task 123 --base main`, { encoding: 'utf8' });
    
    // It should abort due to friction presence
    assert.ok(output.includes('Skipping harvest'));
    assert.ok(output.includes('friction points'));
  });

  it('requires task and sprint parameters', () => {
    try {
      execSync('node .agents/scripts/harvest-golden-path.js', { stdio: 'pipe' });
      assert.fail('Should have exited with error code 1');
    } catch (err) {
      assert.equal(err.status, 1);
    }
  });
});
