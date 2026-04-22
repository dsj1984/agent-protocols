import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_GATES,
  runCloseValidation,
} from '../.agents/scripts/lib/close-validation.js';

const SCRIPT_PATH = path.resolve('.agents/scripts/sprint-story-close.js');

test('sprint-story-close script', async (t) => {
  await t.test('fails without --story argument', () => {
    const result = spawnSync('node', [SCRIPT_PATH]);
    assert.strictEqual(result.status, 1);
    assert.match(
      result.stderr.toString() + result.stdout.toString(),
      /Usage: node sprint-story-close\.js --story <STORY_ID>/,
    );
  });
});

test('runCloseValidation', async (t) => {
  await t.test(
    'DEFAULT_GATES covers lint, test, biome format, and maintainability',
    () => {
      const names = DEFAULT_GATES.map((g) => g.name);
      assert.ok(names.includes('lint'));
      assert.ok(names.includes('test'));
      assert.ok(names.some((n) => n.includes('biome format')));
      assert.ok(names.some((n) => n.includes('maintainability')));
    },
  );

  await t.test('biome format gate surfaces the --write hint', () => {
    const gate = DEFAULT_GATES.find((g) => g.name.includes('biome format'));
    assert.match(gate.hint, /biome format --write/);
  });

  await t.test('maintainability gate surfaces the update-baseline hint', () => {
    const gate = DEFAULT_GATES.find((g) => g.name.includes('maintainability'));
    assert.match(gate.hint, /maintainability:update/);
    assert.match(gate.hint, /commit/i);
  });

  await t.test('returns ok when every gate exits 0', () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0 };
    };
    const gates = [
      { name: 'a', cmd: 'a', args: [] },
      { name: 'b', cmd: 'b', args: [] },
    ];
    const result = runCloseValidation({ cwd: '.', gates, runner });
    assert.deepEqual(result, { ok: true, failed: [] });
    assert.equal(calls.length, 2);
  });

  await t.test('stops and reports on first non-zero gate', () => {
    const runner = (cmd) => ({ status: cmd === 'a' ? 0 : 3 });
    const gates = [
      { name: 'a', cmd: 'a', args: [] },
      { name: 'b', cmd: 'b', args: [], hint: 'fix it' },
      { name: 'c', cmd: 'c', args: [] },
    ];
    const logs = [];
    const result = runCloseValidation({
      cwd: '.',
      gates,
      runner,
      log: (m) => logs.push(m),
    });
    assert.equal(result.ok, false);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].gate.name, 'b');
    assert.equal(result.failed[0].status, 3);
    assert.ok(logs.some((m) => m.includes('hint: fix it')));
  });
});
