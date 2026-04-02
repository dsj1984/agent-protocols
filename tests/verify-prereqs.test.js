import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, '.agents', 'scripts', 'verify-prereqs.js');
const TEST_DIR = path.join(ROOT, 'temp', 'test-verify-prereqs');

describe('Verify Task Prerequisites (Integration)', () => {
    before(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        fs.mkdirSync(TEST_DIR, { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'task-state'), { recursive: true });
        
        // Create a mock playbook.md
        const playbookContent = `# Sprint 001 Playbook

## Tasks
- [x] **001.1.1** Task A
  - Status: COMPLETED
- [ ] **001.1.2** Task B
  - **Dependencies**: \`001.1.1\`
- [ ] **001.2.1** Task C
  - **Dependencies**: \`001.1.2\`
`;
        fs.writeFileSync(path.join(TEST_DIR, 'playbook.md'), playbookContent);
    });

    after(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('passes when intra-playbook dependencies are satisfied ([x])', () => {
        const result = spawnSync('node', [SCRIPT_PATH, 'playbook.md', '001.1.2', 'task-state'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0, `Expected SUCCESS but got FAIL. Output: ${result.stderr}\n${result.stdout}`);
        assert.ok(result.stdout.includes('Prerequisite 001.1.1 is satisfied.'));
        assert.ok(result.stdout.includes('VERIFICATION PASSED'));
    });

    it('blocks when dependencies are not complete in playbook', () => {
        const result = spawnSync('node', [SCRIPT_PATH, 'playbook.md', '001.2.1', 'task-state'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.notEqual(result.status, 0, 'Expected FAIL but got SUCCESS');
        assert.ok(result.stderr.includes('Prerequisite task 001.1.2 is not complete or committed.'));
        assert.ok(result.stderr.includes('VERIFICATION FAILED'));
    });

    it('unblocks when decoupled state (json) is "committed"', () => {
        // Write a task state for 001.1.2
        const stateFile = path.join(TEST_DIR, 'task-state', '001.1.2.json');
        fs.writeFileSync(stateFile, JSON.stringify({ status: 'committed' }));

        const result = spawnSync('node', [SCRIPT_PATH, 'playbook.md', '001.2.1', 'task-state'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0, `Expected SUCCESS (via JSON) but got FAIL. Output: ${result.stderr}`);
        assert.ok(result.stdout.includes('Prerequisite 001.1.2 is satisfied.'));
        assert.ok(result.stdout.includes('VERIFICATION PASSED'));
    });

    it('still blocks if decoupled status is not "committed"', () => {
        // Write a task state that's NOT committed
        const stateFile = path.join(TEST_DIR, 'task-state', '001.1.2.json');
        fs.writeFileSync(stateFile, JSON.stringify({ status: 'executing' }));

        const result = spawnSync('node', [SCRIPT_PATH, 'playbook.md', '001.2.1', 'task-state'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes('Prerequisite task 001.1.2 is not complete or committed.'));
    });

    it('automatically calculates intra-chat precedence', () => {
        const result = spawnSync('node', [SCRIPT_PATH, 'playbook.md', '001.1.2', 'task-state'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        // 001.1.2 implicitly depends on 001.1.1 in the same chat
        assert.equal(result.status, 0);
        assert.ok(result.stdout.includes('Prerequisite 001.1.1 is satisfied.'));
    });
});
