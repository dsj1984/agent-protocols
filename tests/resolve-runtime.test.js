import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
