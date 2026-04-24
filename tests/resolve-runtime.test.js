import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveSessionId,
  resolveWorktreeEnabled,
} from '../.agents/scripts/lib/config-resolver.js';

describe('resolveWorktreeEnabled', () => {
  const cfgOn = { config: { orchestration: { worktreeIsolation: { enabled: true } } } };
  const cfgOff = { config: { orchestration: { worktreeIsolation: { enabled: false } } } };
  const cfgMissing = { config: { orchestration: {} } };

  it("returns true when AP_WORKTREE_ENABLED === 'true' overrides config-off", () => {
    assert.equal(resolveWorktreeEnabled(cfgOff, { AP_WORKTREE_ENABLED: 'true' }), true);
  });

  it("returns false when AP_WORKTREE_ENABLED === 'false' overrides config-on", () => {
    assert.equal(resolveWorktreeEnabled(cfgOn, { AP_WORKTREE_ENABLED: 'false' }), false);
  });

  it('ignores non-strict AP_WORKTREE_ENABLED values ("", "0", "TRUE") and falls through', () => {
    assert.equal(resolveWorktreeEnabled(cfgOn, { AP_WORKTREE_ENABLED: '' }), true);
    assert.equal(resolveWorktreeEnabled(cfgOn, { AP_WORKTREE_ENABLED: '0' }), true);
    assert.equal(resolveWorktreeEnabled(cfgOn, { AP_WORKTREE_ENABLED: 'TRUE' }), true);
    assert.equal(resolveWorktreeEnabled(cfgOff, { AP_WORKTREE_ENABLED: '1' }), false);
  });

  it("returns false when CLAUDE_CODE_REMOTE === 'true' and AP_WORKTREE_ENABLED is unset", () => {
    assert.equal(resolveWorktreeEnabled(cfgOn, { CLAUDE_CODE_REMOTE: 'true' }), false);
  });

  it('AP_WORKTREE_ENABLED outranks CLAUDE_CODE_REMOTE', () => {
    assert.equal(
      resolveWorktreeEnabled(cfgOff, {
        AP_WORKTREE_ENABLED: 'true',
        CLAUDE_CODE_REMOTE: 'true',
      }),
      true,
    );
  });

  it('returns the config value when no env overrides are set', () => {
    assert.equal(resolveWorktreeEnabled(cfgOn, {}), true);
    assert.equal(resolveWorktreeEnabled(cfgOff, {}), false);
  });

  it('returns false when config is missing worktreeIsolation and no env signals', () => {
    assert.equal(resolveWorktreeEnabled(cfgMissing, {}), false);
    assert.equal(resolveWorktreeEnabled({}, {}), false);
    assert.equal(resolveWorktreeEnabled({ config: null }, {}), false);
  });

  it('ignores non-string AP_WORKTREE_ENABLED (no environments pass non-strings, guard anyway)', () => {
    assert.equal(resolveWorktreeEnabled(cfgOff, { AP_WORKTREE_ENABLED: undefined }), false);
  });
});

describe('resolveSessionId', () => {
  it('returns the remote id lower-cased and truncated to 12 chars', () => {
    const id = resolveSessionId({ CLAUDE_CODE_REMOTE_SESSION_ID: 'ABCDEF0123456789XYZ' });
    assert.equal(id, 'abcdef012345');
    assert.equal(id.length, 12);
  });

  it('preserves remote ids shorter than 12 chars', () => {
    const id = resolveSessionId({ CLAUDE_CODE_REMOTE_SESSION_ID: 'abc123' });
    assert.equal(id, 'abc123');
  });

  it('strips disallowed characters from the remote id', () => {
    const id = resolveSessionId({ CLAUDE_CODE_REMOTE_SESSION_ID: 'AB-CD_EF/01:23.45!XYZ' });
    // After strip + lowercase: abcdef012345xyz → truncated to 12
    assert.equal(id, 'abcdef012345');
  });

  it('falls back to a local id when the remote value sanitises to empty', () => {
    const id = resolveSessionId({ CLAUDE_CODE_REMOTE_SESSION_ID: '!@#$%^&*()' });
    assert.match(id, /^[a-z0-9]{1,12}$/);
    // Must not be the empty-sanitised remote value
    assert.notEqual(id, '');
  });

  it('falls back to a local id when CLAUDE_CODE_REMOTE_SESSION_ID is unset', () => {
    const id = resolveSessionId({});
    assert.match(id, /^[a-z0-9]{1,12}$/);
  });

  it('falls back to a local id when CLAUDE_CODE_REMOTE_SESSION_ID is empty string', () => {
    const id = resolveSessionId({ CLAUDE_CODE_REMOTE_SESSION_ID: '' });
    assert.match(id, /^[a-z0-9]{1,12}$/);
  });

  it('local ids vary across calls (entropy present)', () => {
    const a = resolveSessionId({});
    const b = resolveSessionId({});
    // Collisions with 4 random bytes should be astronomically rare; assert
    // inequality so a regression that drops entropy fails loudly.
    assert.notEqual(a, b);
  });
});
