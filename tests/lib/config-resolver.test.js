import assert from 'node:assert/strict';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { Volume } from 'memfs';
import {
  PROJECT_ROOT,
  resolveConfig,
} from '../../.agents/scripts/lib/config-resolver.js';
import { setupFsMock } from './fs-mock.js';

describe('config-resolver library tests', () => {
  let vol;

  beforeEach((t) => {
    vol = new Volume();
    setupFsMock(t, vol);
    // Reset cached config for each test
    resolveConfig({ bustCache: true });
  });

  it('uses default config when .agentrc.json is missing', () => {
    const config = resolveConfig({ bustCache: true });
    assert.equal(config.source, 'built-in defaults');
    assert.equal(config.settings.agentRoot, '.agents');
    assert.equal(config.orchestration, null);
  });

  it('throws error when .agentrc.json is malformed JSON', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(agentrcPath, '{ invalid json }');

    assert.throws(
      () => resolveConfig({ bustCache: true }),
      /\[config\] Failed to parse .agentrc.json/,
    );
  });

  it('throws error when agentSettings contain security violations', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          baseBranch: 'main; rm -rf /',
        },
      }),
    );

    assert.throws(
      () => resolveConfig({ bustCache: true }),
      /\[Security\] Malicious configuration value detected in .agentrc.json/,
    );
  });

  it('rejects malformed release block in agentSettings', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          release: { autoVersionBump: 'yes-please' },
        },
      }),
    );

    assert.throws(() => resolveConfig({ bustCache: true }), /release/);
  });

  it('rejects shell metacharacters in release.versionFile', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          release: { versionFile: 'VERSION; rm -rf /' },
        },
      }),
    );

    assert.throws(() => resolveConfig({ bustCache: true }));
  });

  it('applies environment variable override for notificationWebhookUrl', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          notificationWebhookUrl: 'https://original.com',
        },
        orchestration: {
          provider: 'github',
          github: { owner: 'org', repo: 'repo' },
          notifications: {
            webhookUrl: 'https://original.com',
          },
        },
      }),
    );

    const originalEnv = process.env.NOTIFICATION_WEBHOOK_URL;
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://override.com';

    try {
      const config = resolveConfig({ bustCache: true });
      assert.equal(
        config.settings.notificationWebhookUrl,
        'https://override.com',
      );
      assert.equal(
        config.orchestration.notifications.webhookUrl,
        'https://override.com',
      );
    } finally {
      process.env.NOTIFICATION_WEBHOOK_URL = originalEnv;
    }
  });

  it('resolves .agentrc.json relative to an injected cwd', () => {
    // Two distinct roots, each with its own .agentrc.json — proves the
    // resolver does not read PROJECT_ROOT when an explicit cwd is provided.
    // This is the worktree-isolation invariant: a story agent in a worktree
    // must see its worktree's config, never the main checkout's.
    const rootA = path.resolve(PROJECT_ROOT, '.worktrees/story-A');
    const rootB = path.resolve(PROJECT_ROOT, '.worktrees/story-B');
    vol.mkdirSync(rootA, { recursive: true });
    vol.mkdirSync(rootB, { recursive: true });
    vol.writeFileSync(
      path.join(rootA, '.agentrc.json'),
      JSON.stringify({ agentSettings: { agentRoot: 'A-agents' } }),
    );
    vol.writeFileSync(
      path.join(rootB, '.agentrc.json'),
      JSON.stringify({ agentSettings: { agentRoot: 'B-agents' } }),
    );

    const cfgA = resolveConfig({ bustCache: true, cwd: rootA });
    const cfgB = resolveConfig({ bustCache: true, cwd: rootB });

    assert.equal(cfgA.settings.agentRoot, 'A-agents');
    assert.equal(cfgB.settings.agentRoot, 'B-agents');
    assert.equal(cfgA.source, path.join(rootA, '.agentrc.json'));
    assert.equal(cfgB.source, path.join(rootB, '.agentrc.json'));
  });

  it('caches per-root, returning distinct objects for distinct cwds', () => {
    const rootA = path.resolve(PROJECT_ROOT, '.worktrees/story-X');
    const rootB = path.resolve(PROJECT_ROOT, '.worktrees/story-Y');
    vol.mkdirSync(rootA, { recursive: true });
    vol.mkdirSync(rootB, { recursive: true });
    vol.writeFileSync(
      path.join(rootA, '.agentrc.json'),
      JSON.stringify({ agentSettings: { agentRoot: 'X' } }),
    );
    vol.writeFileSync(
      path.join(rootB, '.agentrc.json'),
      JSON.stringify({ agentSettings: { agentRoot: 'Y' } }),
    );

    const a1 = resolveConfig({ bustCache: true, cwd: rootA });
    const a2 = resolveConfig({ cwd: rootA }); // cache hit
    const b1 = resolveConfig({ bustCache: true, cwd: rootB });

    assert.equal(a1, a2, 'same root → cached identity');
    assert.notEqual(a1, b1, 'different roots → different cached objects');
    assert.equal(b1.settings.agentRoot, 'Y');
  });

  it('falls back to defaults when the injected cwd has no .agentrc.json', () => {
    const emptyRoot = path.resolve(PROJECT_ROOT, '.worktrees/story-empty');
    vol.mkdirSync(emptyRoot, { recursive: true });

    const cfg = resolveConfig({ bustCache: true, cwd: emptyRoot });
    assert.equal(cfg.source, 'built-in defaults');
    assert.equal(cfg.orchestration, null);
  });

  it('merges defaults with loaded config', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          agentRoot: 'custom-agents',
        },
      }),
    );

    const config = resolveConfig({ bustCache: true });
    assert.equal(config.settings.agentRoot, 'custom-agents');
    assert.equal(config.settings.scriptsRoot, '.agents/scripts'); // default
  });
});
