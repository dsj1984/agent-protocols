import assert from 'node:assert';
import { test } from 'node:test';
import { runBranchProtectionCheck } from '../.agents/scripts/check-branch-protection.js';

function stubProvider(overrides = {}) {
  return {
    getEpic: async () => ({ id: 349, labels: [] }),
    getBranchProtection: async () => ({ enabled: true }),
    ...overrides,
  };
}

function trapExit() {
  let exitCode = null;
  const origExit = process.exit;
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`__exit:${code}`);
  };
  return {
    restore() {
      process.exit = origExit;
    },
    code() {
      return exitCode;
    },
  };
}

test('runBranchProtectionCheck skips when epic::auto-close is absent', async () => {
  const provider = stubProvider({
    getEpic: async () => ({ id: 349, labels: ['type::epic'] }),
    getBranchProtection: async () => {
      throw new Error('should not be called');
    },
  });
  const result = await runBranchProtectionCheck({
    epicId: 349,
    base: 'main',
    injectedProvider: provider,
  });
  assert.deepStrictEqual(result, {
    required: false,
    enabled: null,
    skipped: true,
  });
});

test('runBranchProtectionCheck passes when protection is enabled and auto-close is set', async () => {
  const provider = stubProvider({
    getEpic: async () => ({
      id: 349,
      labels: ['type::epic', 'epic::auto-close'],
    }),
    getBranchProtection: async () => ({ enabled: true }),
  });
  const result = await runBranchProtectionCheck({
    epicId: 349,
    base: 'main',
    injectedProvider: provider,
  });
  assert.deepStrictEqual(result, { required: true, enabled: true });
});

test('runBranchProtectionCheck exits 1 when auto-close is set but protection is missing', async () => {
  const provider = stubProvider({
    getEpic: async () => ({ id: 349, labels: ['epic::auto-close'] }),
    getBranchProtection: async () => ({ enabled: false }),
  });
  const trap = trapExit();
  try {
    await assert.rejects(
      runBranchProtectionCheck({
        epicId: 349,
        base: 'main',
        injectedProvider: provider,
      }),
      /__exit:1/,
    );
    assert.strictEqual(trap.code(), 1);
  } finally {
    trap.restore();
  }
});

test('runBranchProtectionCheck exits 2 when fetching the Epic fails', async () => {
  const provider = stubProvider({
    getEpic: async () => {
      throw new Error('transport exploded');
    },
  });
  const trap = trapExit();
  try {
    await assert.rejects(
      runBranchProtectionCheck({
        epicId: 349,
        base: 'main',
        injectedProvider: provider,
      }),
      /__exit:2/,
    );
    assert.strictEqual(trap.code(), 2);
  } finally {
    trap.restore();
  }
});

test('runBranchProtectionCheck exits 1 when provider lacks getBranchProtection', async () => {
  const provider = {
    getEpic: async () => ({ id: 349, labels: ['epic::auto-close'] }),
  };
  const trap = trapExit();
  try {
    await assert.rejects(
      runBranchProtectionCheck({
        epicId: 349,
        base: 'main',
        injectedProvider: provider,
      }),
      /__exit:1/,
    );
    assert.strictEqual(trap.code(), 1);
  } finally {
    trap.restore();
  }
});

test('runBranchProtectionCheck honors --force to run the check without auto-close', async () => {
  const provider = stubProvider({
    getEpic: async () => ({ id: 349, labels: [] }),
    getBranchProtection: async () => ({ enabled: true }),
  });
  const result = await runBranchProtectionCheck({
    epicId: 349,
    base: 'main',
    force: true,
    injectedProvider: provider,
  });
  assert.deepStrictEqual(result, { required: true, enabled: true });
});
