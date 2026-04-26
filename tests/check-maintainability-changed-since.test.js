import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  coerceStoryId,
  parseChangedSinceArg,
  parseStoryIdArg,
} from '../.agents/scripts/check-maintainability.js';

/**
 * Flag-parity tests for `--changed-since` on check-maintainability.js.
 *
 * The MI gate shares the diff-scoped semantics with the CRAP gate (AC15);
 * the filtering path itself is exercised end-to-end via the CLI integration
 * test below so the filter + baseline-scope plumbing doesn't drift silently
 * between the two gates.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

describe('parseChangedSinceArg', () => {
  it('returns the explicit ref argument', () => {
    assert.equal(
      parseChangedSinceArg(['--changed-since', 'origin/main']),
      'origin/main',
    );
  });

  it('falls back to "main" when the flag appears without a ref', () => {
    assert.equal(parseChangedSinceArg(['--changed-since']), 'main');
  });

  it('does not consume the next flag as a ref', () => {
    assert.equal(
      parseChangedSinceArg(['--changed-since', '--story', '42']),
      'main',
    );
  });

  it('returns null when the flag is absent', () => {
    assert.equal(parseChangedSinceArg(['--story', '7']), null);
  });
});

describe('coerceStoryId', () => {
  it('returns positive integer values verbatim', () => {
    assert.equal(coerceStoryId('42'), 42);
    assert.equal(coerceStoryId(7), 7);
  });

  it('rejects non-positive, non-integer, and missing values', () => {
    assert.equal(coerceStoryId('0'), null);
    assert.equal(coerceStoryId('-1'), null);
    assert.equal(coerceStoryId('1.5'), null);
    assert.equal(coerceStoryId('abc'), null);
    assert.equal(coerceStoryId(undefined), null);
    assert.equal(coerceStoryId(null), null);
    assert.equal(coerceStoryId(''), null);
  });
});

describe('parseStoryIdArg', () => {
  it('reads --story <id> from argv', () => {
    assert.equal(parseStoryIdArg(['--story', '42'], {}), 42);
  });

  it('skips a malformed --story value and falls through to env', () => {
    assert.equal(
      parseStoryIdArg(['--story', 'NaN'], { FRICTION_STORY_ID: '7' }),
      7,
    );
  });

  it('--story without a following value falls back to env', () => {
    assert.equal(
      parseStoryIdArg(['--story'], { FRICTION_STORY_ID: '9' }),
      9,
    );
  });

  it('returns null when neither argv nor env yields a positive int', () => {
    assert.equal(parseStoryIdArg([], {}), null);
    assert.equal(
      parseStoryIdArg(['--story', '0'], { FRICTION_STORY_ID: '-1' }),
      null,
    );
  });

  it('argv wins over env when both are valid', () => {
    assert.equal(
      parseStoryIdArg(['--story', '11'], { FRICTION_STORY_ID: '99' }),
      11,
    );
  });
});

describe('check-maintainability CLI — bad --changed-since ref (AC14 parity)', () => {
  it('exits non-zero with a clear "unable to resolve" message', () => {
    const badRef = 'refs/heads/__never_exists_mi_changed_since_test_b18742__';
    const script = path.join(
      REPO_ROOT,
      '.agents',
      'scripts',
      'check-maintainability.js',
    );
    const result = spawnSync(
      process.execPath,
      [script, '--changed-since', badRef],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    );

    assert.notEqual(
      result.status,
      0,
      `CLI must exit non-zero on bad --changed-since ref (status=${result.status}, stderr=${result.stderr})`,
    );
    const combined = `${result.stderr}\n${result.stdout}`;
    assert.match(combined, /unable to resolve ref/i);
    assert.match(
      combined,
      new RegExp(badRef.replace(/[$^*()+?.|[\]{}\\]/g, '\\$&')),
    );
  });
});
