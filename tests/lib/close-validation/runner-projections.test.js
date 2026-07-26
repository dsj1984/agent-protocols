// tests/lib/close-validation/runner-projections.test.js
/**
 * Story #4776 — the projection layer's wiring, asserted at the seam that
 * was missing.
 *
 * `projections/maintainability.js` was fully written, fully unit-tested and
 * imported by nothing: the v2 Epic-tier collapse removed its caller. Unit
 * tests on a module cannot catch that — only a test at the CALLER can. So
 * this file asserts three things a green `maintainability.test.js` was
 * structurally unable to see:
 *
 *   1. `runCloseValidation` actually invokes the projections, and their
 *      advisory reaches close-validation's output (the regression fixture
 *      that previously produced no advisory now produces one).
 *   2. The advisory is advisory: a projected breach with every gate green
 *      still exits 0.
 *   3. No module under `projections/` is importable-but-unimported — the
 *      orphaning itself is now a test failure, for every projection, not
 *      just the one that happened to rot.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProjectionAdvisories } from '../../../.agents/scripts/lib/close-validation/projections/advisories.js';
import { runCloseValidation } from '../../../.agents/scripts/lib/close-validation/runner.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const PROJECTIONS_DIR = path.join(
  REPO_ROOT,
  '.agents/scripts/lib/close-validation/projections',
);

const GREEN_GATE = { name: 'lint', cmd: 'true', args: [] };
const RED_GATE = { name: 'lint', cmd: 'false', args: [] };

function capture() {
  const lines = [];
  return { lines, log: (m) => lines.push(m) };
}

const passingRunner = () => ({ status: 0 });
const failingRunner = () => ({ status: 1 });

describe('runCloseValidation — projection wiring (AC-1)', () => {
  it('invokes the projections with the branch pair and the gate log sink', async () => {
    const seen = [];
    const { log } = capture();
    await runCloseValidation({
      cwd: '/repo',
      gates: [GREEN_GATE],
      runner: passingRunner,
      log,
      baseBranch: 'main',
      storyBranch: 'story-4776',
      config: { marker: true },
      runProjections: async (opts) => {
        seen.push(opts);
        return {};
      },
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].baseBranch, 'main');
    assert.equal(seen[0].storyBranch, 'story-4776');
    assert.deepEqual(seen[0].config, { marker: true });
    assert.equal(typeof seen[0].log, 'function');
  });

  it("runs the projections in the WORKTREE, not the main checkout's cwd", async () => {
    let seen = null;
    await runCloseValidation({
      cwd: '/repo',
      worktreePath: '/repo/.worktrees/story-4776',
      gates: [GREEN_GATE],
      runner: passingRunner,
      baseBranch: 'main',
      storyBranch: 'story-4776',
      runProjections: async (opts) => {
        seen = opts;
      },
    });
    assert.equal(seen.cwd, '/repo/.worktrees/story-4776');
  });

  it("the projection's advisory reaches close-validation's output", async () => {
    const { lines, log } = capture();
    await runCloseValidation({
      cwd: '/repo',
      gates: [GREEN_GATE],
      runner: passingRunner,
      log,
      baseBranch: 'main',
      storyBranch: 'story-4776',
      runProjections: async (opts) => {
        opts.log('[close-validation] ⚠ Pre-merge MI projection: 1 file(s)');
      },
    });
    assert.ok(
      lines.some((l) => l.includes('Pre-merge MI projection')),
      `advisory absent from close-validation output: ${JSON.stringify(lines)}`,
    );
  });

  it('skips the projections when there is no story branch to diff', async () => {
    let called = false;
    await runCloseValidation({
      cwd: '/repo',
      gates: [GREEN_GATE],
      runner: passingRunner,
      baseBranch: 'main',
      runProjections: async () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });

  it('skips the projections after a gate failure', async () => {
    let called = false;
    const result = await runCloseValidation({
      cwd: '/repo',
      gates: [RED_GATE],
      runner: failingRunner,
      baseBranch: 'main',
      storyBranch: 'story-4776',
      runProjections: async () => {
        called = true;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });
});

describe('projections are advisory (AC-4)', () => {
  it('a projected breach with every gate green leaves the verdict ok', async () => {
    const { lines, log } = capture();
    const result = await runCloseValidation({
      cwd: '/repo',
      gates: [GREEN_GATE],
      runner: passingRunner,
      log,
      baseBranch: 'main',
      storyBranch: 'story-4776',
      runProjections: async (opts) => {
        opts.log('[close-validation] ⚠ Pre-merge CRAP projection: 3 method(s)');
        return { crap: { ok: false, breaches: [{}, {}, {}] } };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failed, []);
    assert.ok(lines.some((l) => l.includes('Pre-merge CRAP projection')));
  });

  it('a throwing projection is logged, not propagated', async () => {
    const { lines, log } = capture();
    const result = await runCloseValidation({
      cwd: '/repo',
      gates: [GREEN_GATE],
      runner: passingRunner,
      log,
      baseBranch: 'main',
      storyBranch: 'story-4776',
      runProjections: async () => {
        throw new Error('projection exploded');
      },
    });
    assert.equal(result.ok, true);
    assert.ok(lines.some((l) => l.includes('projection exploded')));
  });
});

describe('runProjectionAdvisories — gate enablement and no-baseline (AC-5)', () => {
  const branch = {
    cwd: '/repo',
    baseBranch: 'main',
    storyBranch: 'story-4776',
  };

  it('self-skips both projections when their gates are disabled', async () => {
    const { lines, log } = capture();
    let ran = false;
    const out = await runProjectionAdvisories({
      ...branch,
      log,
      quality: {
        maintainability: { enabled: false },
        crap: { enabled: false },
      },
      projectMaintainability: async () => {
        ran = true;
        return {};
      },
      projectCrap: async () => {
        ran = true;
        return {};
      },
    });
    assert.equal(ran, false);
    assert.equal(out.maintainability, null);
    assert.equal(out.crap, null);
    assert.ok(
      lines.some((l) => l.includes('maintainability projection skipped')),
    );
    assert.ok(lines.some((l) => l.includes('crap projection skipped')));
  });

  it('runs both projections when the gate blocks are absent (framework default)', async () => {
    const ran = [];
    await runProjectionAdvisories({
      ...branch,
      quality: {},
      projectMaintainability: async () => {
        ran.push('maintainability');
        return { ok: true, regressions: [] };
      },
      projectCrap: async () => {
        ran.push('crap');
        return { ok: true, breaches: [] };
      },
    });
    assert.deepEqual(ran.sort(), ['crap', 'maintainability']);
  });

  it('reports a no-baseline skip without erroring or emitting an advisory', async () => {
    const { lines, log } = capture();
    const out = await runProjectionAdvisories({
      ...branch,
      log,
      quality: {},
      projectMaintainability: async () => ({
        ok: true,
        regressions: [],
        skipped: 'no-baseline',
      }),
      projectCrap: async () => ({
        ok: true,
        breaches: [],
        skipped: 'no-baseline',
      }),
    });
    assert.equal(out.maintainability.skipped, 'no-baseline');
    assert.equal(out.crap.skipped, 'no-baseline');
    assert.equal(
      lines.filter((l) => l.includes('no-baseline')).length,
      2,
      `expected one skip line per kind: ${JSON.stringify(lines)}`,
    );
    assert.equal(
      lines.filter((l) => l.includes('⚠ Pre-merge')).length,
      0,
      'a skip must not emit a breach advisory',
    );
  });

  it('swallows a throwing projection into a logged skip', async () => {
    const { lines, log } = capture();
    const out = await runProjectionAdvisories({
      ...branch,
      log,
      quality: {},
      projectMaintainability: async () => {
        throw new Error('MI scorer died');
      },
      projectCrap: async () => ({ ok: true, breaches: [] }),
    });
    assert.equal(out.maintainability, null);
    assert.ok(lines.some((l) => l.includes('MI scorer died')));
  });

  it('resolves each gate baseline path against cwd and forwards it', async () => {
    let miOpts = null;
    let crapOpts = null;
    await runProjectionAdvisories({
      ...branch,
      quality: {
        maintainability: { baselinePath: 'custom/mi.json' },
        crap: { newMethodCeiling: 42 },
      },
      projectMaintainability: async (o) => {
        miOpts = o;
        return { ok: true, regressions: [] };
      },
      projectCrap: async (o) => {
        crapOpts = o;
        return { ok: true, breaches: [] };
      },
    });
    assert.equal(miOpts.baselinePath, path.resolve('/repo', 'custom/mi.json'));
    assert.equal(
      crapOpts.baselinePath,
      path.resolve('/repo', 'baselines/crap.json'),
    );
    assert.equal(crapOpts.newMethodCeiling, 42);
    assert.equal(typeof crapOpts.scoreFiles, 'function');
  });
});

describe('no orphaned projection modules (AC-8)', () => {
  /**
   * Collect every `.js` file under `.agents/scripts/**` that is NOT itself
   * inside `projections/`, so a projection importing a sibling projection
   * cannot count as its own non-test importer.
   */
  function productionSources(dir, acc = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') {
          continue;
        }
        productionSources(abs, acc);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      if (entry.name.endsWith('.test.js')) continue;
      acc.push(abs);
    }
    return acc;
  }

  /** Resolve every relative `import ... from '<spec>'` in a source file. */
  function importsOf(abs) {
    const src = readFileSync(abs, 'utf8');
    const out = [];
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      out.push(path.resolve(path.dirname(abs), m[1]));
    }
    return out;
  }

  it('every module under projections/ has a non-test importer', () => {
    const projections = readdirSync(PROJECTIONS_DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .map((f) => path.join(PROJECTIONS_DIR, f));
    assert.ok(projections.length > 0, 'no projection modules found');

    const sources = productionSources(path.join(REPO_ROOT, '.agents/scripts'));
    const outsideProjections = sources.filter(
      (abs) => !abs.startsWith(`${PROJECTIONS_DIR}${path.sep}`),
    );

    // Reachability, not a bare grep: a projection imported only by another
    // projection is still orphaned if that whole cluster is unreachable from
    // production. Seed from every production module OUTSIDE projections/ and
    // walk the import graph inward.
    const reachable = new Set();
    const queue = [];
    for (const abs of outsideProjections) {
      for (const target of importsOf(abs)) {
        if (target.startsWith(`${PROJECTIONS_DIR}${path.sep}`))
          queue.push(target);
      }
    }
    while (queue.length > 0) {
      const next = queue.pop();
      if (reachable.has(next)) continue;
      reachable.add(next);
      for (const target of importsOf(next)) queue.push(target);
    }

    const orphans = projections
      .filter((abs) => !reachable.has(abs))
      .map((abs) => path.basename(abs));
    assert.deepEqual(
      orphans,
      [],
      `orphaned projection module(s) — written, tested, and reachable from nothing in production: ${orphans.join(', ')}`,
    );
  });
});
