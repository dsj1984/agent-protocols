import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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
