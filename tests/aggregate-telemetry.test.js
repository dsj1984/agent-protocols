import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, '.agents', 'scripts', 'aggregate-telemetry.js');
const TEST_DIR = path.join(ROOT, 'temp', 'test-aggregate-telemetry');

describe('Aggregate Telemetry Observer', () => {
    before(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        
        fs.mkdirSync(TEST_DIR, { recursive: true });
        const SPRINTS_DIR = path.join(TEST_DIR, 'docs', 'sprints');
        fs.mkdirSync(SPRINTS_DIR, { recursive: true });

        // Setup some mock sprints with friction logs
        for (let i = 1; i <= 2; i++) {
            const sprintNum = String(i).padStart(3, '0');
            const sprintDir = path.join(SPRINTS_DIR, `sprint-${sprintNum}`);
            fs.mkdirSync(sprintDir, { recursive: true });
            
            const logLines = [
                JSON.stringify({ timestamp: new Date().toISOString(), type: "friction_point", tool: "git", errorPreview: "conflict" }),
                JSON.stringify({ timestamp: new Date().toISOString(), type: "token_usage", usage: 1000 }),
                JSON.stringify({ timestamp: new Date().toISOString(), type: "tool_failure", tool: "pnpm", errorPreview: "not found" })
            ];
            
            fs.writeFileSync(path.join(sprintDir, 'agent-friction-log.json'), logLines.join('\n'));
        }
    });

    after(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('aggregates data across multiple sprints', () => {
        const result = spawnSync('node', [SCRIPT_PATH, '--from', '1', '--to', '2'], {
            cwd: TEST_DIR,
            env: { ...process.env, AGENT_PROJECT_ROOT: TEST_DIR },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0);
        assert.ok(fs.existsSync(path.join(TEST_DIR, 'docs', 'telemetry', 'observer-report.md')));
        
        const report = fs.readFileSync(path.join(TEST_DIR, 'docs', 'telemetry', 'observer-report.md'), 'utf8');
        assert.ok(report.includes('| **Sprints Analyzed** | 2 |'), 'Should have analyzed 2 sprints');
        assert.ok(report.includes('| **Total Tokens Consumed** | 2,000 |'), 'Should aggregate tokens correctly');
        assert.ok(report.includes('| `git` | 2 |'), 'Should aggregate git failures');
        assert.ok(report.includes('| `pnpm` | 2 |'), 'Should aggregate pnpm failures');
    });

    it('handles range filtering correctly', () => {
        const result = spawnSync('node', [SCRIPT_PATH, '--from', '2', '--to', '2'], {
            cwd: TEST_DIR,
            env: { ...process.env, AGENT_PROJECT_ROOT: TEST_DIR },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0);
        const report = fs.readFileSync(path.join(TEST_DIR, 'docs', 'telemetry', 'observer-report.md'), 'utf8');
        assert.ok(report.includes('| **Sprints Analyzed** | 1 |'), 'Should only analyze 1 sprint (002)');
        assert.ok(report.includes('| **Total Tokens Consumed** | 1,000 |'), 'Should aggregate tokens correctly for range');
    });

    it('fails gracefully if sprints directory is missing', () => {
        // First run in before() created docs/sprints
        // Remove it now
        if (fs.existsSync(path.join(TEST_DIR, 'docs'))) {
            fs.rmSync(path.join(TEST_DIR, 'docs'), { recursive: true, force: true });
        }

        const result = spawnSync('node', [SCRIPT_PATH], {
            cwd: TEST_DIR,
            env: { ...process.env, AGENT_PROJECT_ROOT: TEST_DIR },
            encoding: 'utf-8'
        });

        assert.notEqual(result.status, 0);
        assert.ok(result.stderr?.includes('Sprints directory not found'), `Expected error message not found in stderr: ${result.stderr}`);
    });

});
