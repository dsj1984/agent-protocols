/**
 * apply-quality-bootstrap — Story #4171
 * (refactor(mandrel-update): extract the quality-bootstrap heredoc into a
 * tested script)
 *
 * Exercises the script that replaced Step 3.5's inline `node -e` heredoc. The
 * Story's acceptance criteria are:
 *
 *   1. The script calls `applyQualityBootstrap` and prints the `{ quality }`
 *      JSON envelope.
 *   2. It is idempotent — a second run is a no-op beyond reporting.
 *   3. A unit test exercises the script against the helper, covering the
 *      success path and an idempotent re-run.
 *
 * The composition is tested two ways: against the *real* helper in a tmp
 * project tree (success path + idempotent re-run, asserting on-disk effects),
 * and against an injected stub (asserting the wiring — that the helper is
 * invoked with the project root).
 *
 * Story #5007 retired the second `migrateBaselinesLayout` step, so the
 * envelope no longer carries a `baselines` key.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { applyBootstrapAndMigration } from '../../.agents/scripts/apply-quality-bootstrap.js';

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('applyBootstrapAndMigration — wiring (stubbed helper)', () => {
  it('invokes the quality helper with the project root and returns the single-key envelope', () => {
    const calls = { quality: [] };
    const projectRoot = '/tmp/some-consumer';

    const result = applyBootstrapAndMigration({
      projectRoot,
      applyQualityBootstrap: (ctx) => {
        calls.quality.push(ctx);
        return { helper: { action: 'already-present' } };
      },
    });

    // applyQualityBootstrap receives { projectRoot }.
    assert.equal(calls.quality.length, 1);
    assert.deepEqual(calls.quality[0], { projectRoot });

    // Story #5007: the retired baselines migration is gone from the envelope.
    assert.deepEqual(Object.keys(result), ['quality']);
    assert.deepEqual(result.quality, { helper: { action: 'already-present' } });
  });
});

describe('applyBootstrapAndMigration — real helper against a tmp project', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'apply-quality-bootstrap-'),
    );
    // The guardrails helper is materialized under the project's own
    // `.agents/` tree (the npm-distribution shape: `mandrel update`'s sync
    // step already places it there, so the bootstrap reports the helper as
    // already-present). The default `frameworkRoot` the helper falls back to
    // is `<projectRoot>/.agents`, so this is also the copy source.
    const helperSource = path.join(
      tmpRoot,
      '.agents',
      'workflows',
      'helpers',
      'code-quality-guardrails.md',
    );
    fs.mkdirSync(path.dirname(helperSource), { recursive: true });
    fs.writeFileSync(helperSource, '# code-quality-guardrails\n', 'utf8');

    // A minimal consumer package.json + .agentrc.json so the npm-script and
    // config seeds have somewhere to land.
    writeJson(path.join(tmpRoot, 'package.json'), {
      name: 'consumer',
      scripts: {},
    });
    writeJson(path.join(tmpRoot, '.agentrc.json'), {});
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('runs the quality install, returns the { quality } envelope, and applies the on-disk effects', () => {
    const result = applyBootstrapAndMigration({ projectRoot: tmpRoot });

    assert.deepEqual(Object.keys(result), ['quality']);
    assert.ok(result.quality.helper);
    assert.ok(result.quality.hook);
    assert.ok(result.quality.scripts);
    assert.ok(result.quality.config);

    // Quality bootstrap applied its on-disk effects: the guardrails helper
    // is present, the pre-commit hook was created, and the npm scripts were
    // backfilled. (The helper reports `already-present` because the npm
    // distribution materializes it under `.agents/` ahead of the bootstrap.)
    assert.equal(result.quality.helper.action, 'already-present');
    assert.equal(result.quality.hook.action, 'created');
    assert.equal(result.quality.scripts.action, 'updated');

    assert.ok(
      fs.existsSync(
        path.join(
          tmpRoot,
          '.agents',
          'workflows',
          'helpers',
          'code-quality-guardrails.md',
        ),
      ),
    );
    assert.ok(fs.existsSync(path.join(tmpRoot, '.husky', 'pre-commit')));
    const pkg = readJson(path.join(tmpRoot, 'package.json'));
    assert.equal(typeof pkg.scripts['quality:preview'], 'string');
    assert.equal(typeof pkg.scripts['quality:watch'], 'string');

    // No committed baselines/epic tree in this fixture → prune is a no-op.
    assert.equal(result.quality.legacyBaselines.action, 'absent');
  });

  it('is idempotent — a second run is a no-op beyond reporting and leaves identical on-disk state', () => {
    // First run lands all effects.
    applyBootstrapAndMigration({ projectRoot: tmpRoot });

    // Snapshot the files the bootstrap writes after the first run.
    const snapshot = () => ({
      hook: fs.readFileSync(path.join(tmpRoot, '.husky', 'pre-commit'), 'utf8'),
      pkg: fs.readFileSync(path.join(tmpRoot, 'package.json'), 'utf8'),
      agentrc: fs.readFileSync(path.join(tmpRoot, '.agentrc.json'), 'utf8'),
    });
    const before = snapshot();

    const second = applyBootstrapAndMigration({ projectRoot: tmpRoot });

    // Every install path reports the idempotent no-op outcome on re-run.
    assert.equal(second.quality.helper.action, 'already-present');
    assert.equal(second.quality.hook.action, 'already-present');
    assert.equal(second.quality.scripts.action, 'no-change');
    assert.equal(second.quality.config.action, 'no-change');
    assert.equal(second.quality.legacyBaselines.action, 'absent');

    // The files are byte-for-byte identical after the second run — the
    // re-run mutates nothing on disk.
    assert.deepEqual(snapshot(), before);
  });
});
