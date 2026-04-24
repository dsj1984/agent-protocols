import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getChangedFiles } from '../../.agents/scripts/lib/changed-files.js';

/**
 * Tests for the `--changed-since` helper. Covers the contract that matters
 * at the CLI boundary: successful diff parsing, empty-diff handling, path
 * normalization, and fail-closed behavior on a bad ref.
 */

function makeGit(result) {
  const calls = [];
  return {
    calls,
    iface: {
      gitSpawn: (cwd, ...args) => {
        calls.push({ cwd, args });
        return result;
      },
      gitSync: () => {
        throw new Error('gitSync not used by getChangedFiles');
      },
    },
  };
}

describe('getChangedFiles', () => {
  it('returns the list from `git diff --name-only <ref>...HEAD`', () => {
    const { iface, calls } = makeGit({
      status: 0,
      stdout: '.agents/scripts/foo.js\n.agents/scripts/bar.js\n',
      stderr: '',
    });
    const out = getChangedFiles({ ref: 'main', cwd: '/repo', git: iface });
    assert.deepEqual(out, [
      '.agents/scripts/foo.js',
      '.agents/scripts/bar.js',
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, '/repo');
    assert.deepEqual(calls[0].args, ['diff', '--name-only', 'main...HEAD']);
  });

  it('defaults to `main` when ref is not supplied', () => {
    const { iface, calls } = makeGit({ status: 0, stdout: '', stderr: '' });
    getChangedFiles({ cwd: '/repo', git: iface });
    assert.deepEqual(calls[0].args, ['diff', '--name-only', 'main...HEAD']);
  });

  it('returns an empty array when the diff is empty (no newline noise)', () => {
    const { iface } = makeGit({ status: 0, stdout: '', stderr: '' });
    const out = getChangedFiles({ ref: 'main', cwd: '/repo', git: iface });
    assert.deepEqual(out, []);
  });

  it('normalizes Windows-style separators so set-membership lines up with scanner output', () => {
    const { iface } = makeGit({
      status: 0,
      stdout: '.agents\\scripts\\foo.js\n',
      stderr: '',
    });
    const out = getChangedFiles({ ref: 'main', cwd: '/repo', git: iface });
    assert.deepEqual(out, ['.agents/scripts/foo.js']);
  });

  it('throws a clear, ref-naming error on non-zero git exit (bad ref)', () => {
    const { iface } = makeGit({
      status: 128,
      stdout: '',
      stderr:
        "fatal: ambiguous argument 'bogus': unknown revision or path not in the working tree.",
    });
    assert.throws(
      () => getChangedFiles({ ref: 'bogus', cwd: '/repo', git: iface }),
      (err) =>
        err instanceof Error &&
        /unable to resolve ref "bogus"/.test(err.message) &&
        /ambiguous argument/.test(err.message),
    );
  });

  it('throws when git exits non-zero even with no stderr, surfacing the exit code', () => {
    const { iface } = makeGit({ status: 1, stdout: '', stderr: '' });
    assert.throws(
      () => getChangedFiles({ ref: 'main', cwd: '/repo', git: iface }),
      (err) =>
        err instanceof Error &&
        /unable to resolve ref "main"/.test(err.message) &&
        /exit 1/.test(err.message),
    );
  });
});
