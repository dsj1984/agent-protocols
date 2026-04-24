import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseChangedSinceArg } from '../.agents/scripts/check-maintainability.js';

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
