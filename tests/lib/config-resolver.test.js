import assert from 'node:assert/strict';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { Volume } from 'memfs';
import {
  MAINTAINABILITY_CRAP_DEFAULTS,
  PROJECT_ROOT,
  resolveConfig,
  resolveListValue,
  resolveMaintainability,
  resolveMaintainabilityCrap,
} from '../../.agents/scripts/lib/config-resolver.js';
import { setupFsMock } from './fs-mock.js';

/** The schema requires `agentRoot` / `docsRoot` / `tempRoot` on every loaded
 * agentSettings block. Spread this into fixtures that aren't testing the
 * required-key behaviour itself so the resolver gets past validation and
 * exercises the code path under test. */
const REQ = Object.freeze({
  agentRoot: '.agents',
  docsRoot: 'docs',
  tempRoot: 'temp',
});

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
    // `agentRoot` is no longer a zero-config default — it is hard-required by
    // the schema so a config without it cannot be silently filled in.
    assert.equal(config.settings.agentRoot, undefined);
    assert.equal(config.settings.scriptsRoot, '.agents/scripts');
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
          agentRoot: '.agents',
          docsRoot: 'docs',
          tempRoot: 'temp',
        },
      }),
    );

    assert.throws(
      () => resolveConfig({ bustCache: true }),
      /\[config\] Invalid agentSettings in .agentrc.json/,
    );
  });

  it('rejects malformed release block in agentSettings', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          ...REQ,
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
          ...REQ,
          release: { versionFile: 'VERSION; rm -rf /' },
        },
      }),
    );

    assert.throws(() => resolveConfig({ bustCache: true }));
  });

  it('accepts release.versionFile: null (default shape)', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          ...REQ,
          release: { versionFile: null },
        },
      }),
    );

    assert.doesNotThrow(() => resolveConfig({ bustCache: true }));
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
      JSON.stringify({ agentSettings: { ...REQ, agentRoot: 'A-agents' } }),
    );
    vol.writeFileSync(
      path.join(rootB, '.agentrc.json'),
      JSON.stringify({ agentSettings: { ...REQ, agentRoot: 'B-agents' } }),
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
      JSON.stringify({ agentSettings: { ...REQ, agentRoot: 'X' } }),
    );
    vol.writeFileSync(
      path.join(rootB, '.agentrc.json'),
      JSON.stringify({ agentSettings: { ...REQ, agentRoot: 'Y' } }),
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

  it('throws when orchestration.epicRunner is missing concurrencyCap', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: { ...REQ },
        orchestration: {
          provider: 'github',
          github: { owner: 'org', repo: 'repo' },
          epicRunner: { enabled: true, pollIntervalSec: 30 },
        },
      }),
    );

    assert.throws(
      () => resolveConfig({ bustCache: true }),
      /Invalid orchestration configuration/,
    );
  });

  it('skips orchestration validation when { validate: false }', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: { ...REQ },
        orchestration: {
          provider: 'github',
          github: { owner: 'org', repo: 'repo' },
          epicRunner: { enabled: true, pollIntervalSec: 30 },
        },
      }),
    );

    assert.doesNotThrow(() =>
      resolveConfig({ bustCache: true, validate: false }),
    );
  });

  it('merges defaults with loaded config', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(
      agentrcPath,
      JSON.stringify({
        agentSettings: {
          ...REQ,
          agentRoot: 'custom-agents',
        },
      }),
    );

    const config = resolveConfig({ bustCache: true });
    assert.equal(config.settings.agentRoot, 'custom-agents');
    assert.equal(config.settings.scriptsRoot, '.agents/scripts'); // default
  });

  describe('maintainability.crap defaults + deep-merge', () => {
    it('injects full crap defaults when the block is absent', () => {
      const config = resolveConfig({ bustCache: true });
      assert.deepEqual(config.settings.maintainability.crap, {
        enabled: true,
        targetDirs: ['src'],
        newMethodCeiling: 30,
        coveragePath: 'coverage/coverage-final.json',
        tolerance: 0.001,
        requireCoverage: true,
        friction: { markerKey: 'crap-baseline-regression' },
        refreshTag: 'baseline-refresh:',
      });
    });

    it('injects crap defaults when loaded config omits the block', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({ agentSettings: { ...REQ } }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.equal(config.settings.maintainability.crap.newMethodCeiling, 30);
      assert.deepEqual(config.settings.maintainability.crap.targetDirs, [
        'src',
      ]);
    });

    it('{ append } extends targetDirs and dedupes within user input', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: {
              crap: {
                targetDirs: {
                  // Intentionally include a duplicate to prove dedupe within
                  // the user-supplied list.
                  append: ['packages/foo/src', 'packages/foo/src'],
                },
              },
            },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.deepEqual(config.settings.maintainability.crap.targetDirs, [
        'src',
        'packages/foo/src',
      ]);
    });

    it('{ prepend } places entries before append, atop the framework default', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: {
              crap: {
                targetDirs: {
                  prepend: ['apps/web/src'],
                  append: ['packages/lib/src'],
                },
              },
            },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.deepEqual(config.settings.maintainability.crap.targetDirs, [
        'apps/web/src',
        'src',
        'packages/lib/src',
      ]);
    });

    it('plain-array targetDirs replaces framework defaults', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: { crap: { targetDirs: ['src'] } },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.deepEqual(config.settings.maintainability.crap.targetDirs, [
        'src',
      ]);
    });

    it('scalar override leaves other crap defaults intact', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: { crap: { newMethodCeiling: 40 } },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      const crap = config.settings.maintainability.crap;
      assert.equal(crap.newMethodCeiling, 40);
      assert.equal(crap.enabled, true);
      assert.equal(crap.tolerance, 0.001);
      assert.equal(crap.coveragePath, 'coverage/coverage-final.json');
      assert.deepEqual(crap.targetDirs, ['src']);
      assert.deepEqual(crap.friction, {
        markerKey: 'crap-baseline-regression',
      });
    });

    it('unknown crap key warns but does not fail resolution', (t) => {
      const warnings = [];
      t.mock.method(console, 'warn', (msg) => warnings.push(msg));

      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: {
              crap: { newMethodCeiling: 40, nonsenseKey: true },
            },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.equal(config.settings.maintainability.crap.newMethodCeiling, 40);
      assert.ok(
        warnings.some((m) => /nonsenseKey/.test(m)),
        `expected a warning mentioning 'nonsenseKey'; got ${JSON.stringify(warnings)}`,
      );
    });

    it('top-level maintainability.targetDirs supports { append }', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: { targetDirs: { append: ['packages/foo'] } },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.deepEqual(config.settings.maintainability.targetDirs, [
        'packages/foo',
      ]);
    });

    it('friction.markerKey override merges shallowly with defaults', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: {
              crap: { friction: { markerKey: 'custom-marker' } },
            },
          },
        }),
      );

      const config = resolveConfig({ bustCache: true });
      assert.deepEqual(config.settings.maintainability.crap.friction, {
        markerKey: 'custom-marker',
      });
    });

    it('rejects a malformed crap block (invalid scalar type)', () => {
      const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
      vol.mkdirSync(PROJECT_ROOT, { recursive: true });
      vol.writeFileSync(
        agentrcPath,
        JSON.stringify({
          agentSettings: {
            ...REQ,
            maintainability: { crap: { newMethodCeiling: 'tall' } },
          },
        }),
      );

      assert.throws(() => resolveConfig({ bustCache: true }));
    });
  });

  describe('deep-merge helpers (unit)', () => {
    it('resolveListValue: undefined → copy of default', () => {
      const d = ['a', 'b'];
      const result = resolveListValue(d, undefined);
      assert.deepEqual(result, ['a', 'b']);
      assert.notEqual(result, d, 'returns a fresh array');
    });

    it('resolveListValue: plain array replaces', () => {
      assert.deepEqual(resolveListValue(['a'], ['x', 'y']), ['x', 'y']);
    });

    it('resolveListValue: { append } extends and dedupes', () => {
      assert.deepEqual(resolveListValue(['a', 'b'], { append: ['b', 'c'] }), [
        'a',
        'b',
        'c',
      ]);
    });

    it('resolveListValue: { prepend } places before defaults and dedupes', () => {
      assert.deepEqual(resolveListValue(['a', 'b'], { prepend: ['z', 'a'] }), [
        'z',
        'a',
        'b',
      ]);
    });

    it('resolveListValue: { append, prepend } combine', () => {
      assert.deepEqual(
        resolveListValue(['b'], { prepend: ['a'], append: ['c'] }),
        ['a', 'b', 'c'],
      );
    });

    it('resolveMaintainabilityCrap: returns frozen-ish fresh object from defaults', () => {
      const a = resolveMaintainabilityCrap(undefined);
      const b = resolveMaintainabilityCrap(undefined);
      assert.notEqual(a, b, 'distinct instances per call');
      assert.notEqual(
        a.targetDirs,
        MAINTAINABILITY_CRAP_DEFAULTS.targetDirs,
        'targetDirs is a copy, not the frozen default array',
      );
      a.targetDirs.push('mutate');
      assert.deepEqual(b.targetDirs, ['src']);
    });

    it('resolveMaintainability: userBlock null → both targetDirs + crap defaults', () => {
      const out = resolveMaintainability(undefined);
      assert.deepEqual(out.targetDirs, []);
      assert.equal(out.crap.newMethodCeiling, 30);
    });
  });
});
