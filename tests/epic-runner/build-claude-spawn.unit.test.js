/**
 * Pure-helper tests for `build-claude-spawn`. The integration test exercises
 * the host platform's branch only; these unit tests cover the platform-
 * conditional helpers (`cmdQuote`, `buildWindowsCmdline`) on every host so
 * the CRAP baseline is platform-stable.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildClaudeSpawn,
  buildWindowsCmdline,
  cmdQuote,
} from '../../.agents/scripts/lib/orchestration/epic-runner/build-claude-spawn.js';

describe('cmdQuote', () => {
  it('passes through tokens with no shell-meaningful chars', () => {
    assert.equal(cmdQuote('claude'), 'claude');
    assert.equal(cmdQuote('--version'), '--version');
    assert.equal(cmdQuote('/sprint-execute'), '/sprint-execute');
  });
  it('quotes tokens containing whitespace', () => {
    assert.equal(cmdQuote('hello world'), '"hello world"');
  });
  it('quotes tokens containing each shell-meaningful character', () => {
    for (const ch of ['&', '|', '<', '>', '^']) {
      assert.equal(cmdQuote(`a${ch}b`), `"a${ch}b"`);
    }
  });
  it('doubles embedded double-quotes per cmd.exe convention', () => {
    assert.equal(cmdQuote('a"b'), '"a""b"');
  });
});

describe('buildWindowsCmdline', () => {
  it('joins bin + argv with cmd.exe quoting', () => {
    assert.equal(
      buildWindowsCmdline('claude', ['/sprint-execute', '386']),
      'claude /sprint-execute 386',
    );
  });
  it('quotes arguments that contain spaces so they reach the child as one token', () => {
    assert.equal(
      buildWindowsCmdline('claude', ['/run', 'two words']),
      'claude /run "two words"',
    );
  });
  it('handles an empty argv', () => {
    assert.equal(buildWindowsCmdline('claude', []), 'claude');
  });
});

describe('buildClaudeSpawn', () => {
  it('uses CLAUDE_BIN when set', () => {
    const prev = process.env.CLAUDE_BIN;
    process.env.CLAUDE_BIN = 'node';
    try {
      const out = buildClaudeSpawn(['--version'], {});
      assert.match(process.platform === 'win32' ? out.file : out.file, /node/);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_BIN;
      else process.env.CLAUDE_BIN = prev;
    }
  });
  it('preserves caller-supplied options under both platforms', () => {
    const out = buildClaudeSpawn(['--version'], { stdio: 'pipe' });
    assert.equal(out.options.stdio, 'pipe');
    if (process.platform === 'win32') {
      assert.equal(out.options.shell, true);
      assert.deepEqual(out.args, []);
    } else {
      assert.equal(out.options.shell, false);
      assert.deepEqual(out.args, ['--version']);
    }
  });
  it('forces win32 branch via injected platform', () => {
    const out = buildClaudeSpawn(['/sprint-execute', '386'], {}, 'win32');
    assert.equal(out.options.shell, true);
    assert.deepEqual(out.args, []);
    assert.match(out.file, /\/sprint-execute 386/);
  });
  it('forces posix branch via injected platform', () => {
    const out = buildClaudeSpawn(['/sprint-execute', '386'], {}, 'linux');
    assert.equal(out.options.shell, false);
    assert.deepEqual(out.args, ['/sprint-execute', '386']);
  });
});
