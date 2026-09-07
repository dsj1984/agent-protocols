/**
 * quality-bootstrap — Story #1401 (Epic #1386)
 *
 * Drives `applyQualityBootstrap` against a tmp project tree to assert the
 * four artefacts the stabilized-gates Epic ships:
 *
 *   1. The `code-quality-guardrails.md` helper lands under
 *      `.agents/workflows/helpers/`.
 *   2. `.husky/pre-commit` carries the `quality:preview` invocation, and a
 *      pre-existing custom hook is preserved with a `custom-hook-skip`
 *      outcome.
 *   3. `quality:preview` and `quality:watch` npm scripts are registered
 *      idempotently in `package.json`.
 *   4. `agentSettings.quality.codingGuardrails` and `autoRefresh` defaults
 *      are seeded into `.agentrc.json` without clobbering existing values.
 *
 * Each scenario exercises the re-run path so the workflow's idempotence
 * guarantee is enforced by the test suite, not just prose.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  BASELINE_MERGE_ATTRIBUTE,
  ensureBaselineMergeDriver,
} from '../../.agents/scripts/lib/bootstrap/baseline-merge-driver.js';
import {
  applyQualityBootstrap,
  DOWNSTREAM_PRE_COMMIT,
  ensureGuardrailsHelper,
  ensurePreCommitHook,
  ensureQualityConfigDefaults,
  ensureQualityNpmScripts,
  PRE_COMMIT_MARKER,
  QUALITY_NPM_SCRIPTS,
} from '../../.agents/scripts/lib/bootstrap/quality-bootstrap.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

let tmpRoot;
let frameworkRoot;

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

beforeEach(() => {
  tmpRoot = makeTempDir('quality-bootstrap-');
  // Stand up a minimal "framework" tree so the helper has a copy source.
  // Real-world callers pass the path to their materialized `.agents/` checkout.
  frameworkRoot = path.join(tmpRoot, '_framework');
  const helperSource = path.join(
    frameworkRoot,
    'workflows',
    'helpers',
    'code-quality-guardrails.md',
  );
  fs.mkdirSync(path.dirname(helperSource), { recursive: true });
  fs.writeFileSync(helperSource, '# Code Quality Guardrails — fixture\n');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeProject(overrides = {}) {
  const root = path.join(tmpRoot, 'project');
  fs.mkdirSync(root, { recursive: true });
  if (overrides.packageJson !== false) {
    writeJson(
      path.join(root, 'package.json'),
      overrides.packageJson ?? {
        name: 'tmp-project',
        version: '0.0.0',
        type: 'module',
        scripts: { test: 'echo ok' },
      },
    );
  }
  if (overrides.agentrc !== false) {
    writeJson(
      path.join(root, '.agentrc.json'),
      overrides.agentrc ?? {
        agentSettings: { baseBranch: 'main' },
      },
    );
  }
  return root;
}

describe('quality-bootstrap — fresh tmp project', () => {
  it('installs helper/hook/scripts but skips default-equal config seeds (Story #2281)', () => {
    const projectRoot = makeProject();

    // First run: helper / hook / scripts mutate. The config step is a
    // no-change because every key the seed would write equals the
    // framework default — the runtime layers those at read time.
    const first = applyQualityBootstrap({ projectRoot, frameworkRoot });
    assert.equal(first.helper.action, 'copied');
    assert.equal(first.hook.action, 'created');
    assert.equal(first.scripts.action, 'updated');
    assert.equal(first.config.action, 'no-change');
    // Every quality leaf is reported under skippedKeys so callers can
    // surface why the seed was a no-op.
    const skipped = first.config.skippedKeys ?? [];
    assert.ok(skipped.some((k) => k.endsWith('cyclomaticFlag')));
    assert.ok(skipped.some((k) => k.endsWith('autoRefresh.enabled')));

    // Helper landed where the bootstrap step says it should.
    assert.ok(
      fs.existsSync(
        path.join(
          projectRoot,
          '.agents',
          'workflows',
          'helpers',
          'code-quality-guardrails.md',
        ),
      ),
    );

    // Hook carries the quality-preview invocation verbatim.
    const hookBody = fs.readFileSync(
      path.join(projectRoot, '.husky', 'pre-commit'),
      'utf8',
    );
    assert.ok(hookBody.includes(PRE_COMMIT_MARKER));
    assert.equal(hookBody, DOWNSTREAM_PRE_COMMIT);

    // Both npm scripts present with their framework-default values.
    const pkg = readJson(path.join(projectRoot, 'package.json'));
    for (const [name, cmd] of Object.entries(QUALITY_NPM_SCRIPTS)) {
      assert.equal(pkg.scripts[name], cmd);
    }
    // Pre-existing scripts preserved.
    assert.equal(pkg.scripts.test, 'echo ok');

    // The on-disk config is left at the minimum that validates — no
    // empty `delivery.quality.*` scaffolding has been written.
    const cfg = readJson(path.join(projectRoot, '.agentrc.json'));
    assert.ok(
      cfg.delivery === undefined ||
        cfg.delivery.quality === undefined ||
        Object.keys(cfg.delivery.quality).length === 0,
      'default-equal seeds must not materialise as on-disk keys',
    );

    // Second run: every step short-circuits.
    const second = applyQualityBootstrap({ projectRoot, frameworkRoot });
    assert.equal(second.helper.action, 'already-present');
    assert.equal(second.hook.action, 'already-present');
    assert.equal(second.scripts.action, 'no-change');
    assert.equal(second.config.action, 'no-change');
  });
});

describe('quality-bootstrap — preserves operator overrides', () => {
  it('does not clobber a custom .husky/pre-commit hook', () => {
    const projectRoot = makeProject();
    const hookPath = path.join(projectRoot, '.husky', 'pre-commit');
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    const customBody = '#!/usr/bin/env sh\nnpm run my-custom-check\n';
    fs.writeFileSync(hookPath, customBody);

    const result = ensurePreCommitHook({ projectRoot });
    assert.equal(result.action, 'custom-hook-skip');
    assert.match(result.notice, /Custom \.husky\/pre-commit detected/);
    // The custom hook is left exactly as the operator wrote it.
    assert.equal(fs.readFileSync(hookPath, 'utf8'), customBody);
    // The notice carries the snippet the operator should merge in by hand.
    assert.ok(result.snippet.includes(PRE_COMMIT_MARKER));
  });

  it('preserves existing npm script values and only fills missing keys', () => {
    const projectRoot = makeProject({
      packageJson: {
        name: 'tmp-project',
        version: '0.0.0',
        type: 'module',
        scripts: {
          'quality:preview': 'node my-custom-preview.js',
          test: 'echo ok',
        },
      },
    });

    const result = ensureQualityNpmScripts({ projectRoot });
    assert.equal(result.action, 'updated');
    assert.equal(result.scripts['quality:preview'], 'already-present');
    assert.equal(result.scripts['quality:watch'], 'added');

    const pkg = readJson(path.join(projectRoot, 'package.json'));
    assert.equal(pkg.scripts['quality:preview'], 'node my-custom-preview.js');
    assert.equal(
      pkg.scripts['quality:watch'],
      QUALITY_NPM_SCRIPTS['quality:watch'],
    );
  });

  it('preserves operator overrides and does NOT seed default-equal siblings (Story #2281)', () => {
    const projectRoot = makeProject({
      agentrc: {
        // Post-reshape: quality lives under `delivery.quality.*`.
        project: { baseBranch: 'main' },
        delivery: {
          quality: {
            codingGuardrails: { cyclomaticFlag: 6 },
            // autoRefresh entirely absent. Under the Story #2281
            // contract, absent keys whose intended value equals the
            // framework default are NOT seeded — the runtime layers
            // defaults at read time.
          },
        },
      },
    });

    const result = ensureQualityConfigDefaults({ projectRoot });
    assert.equal(result.action, 'no-change');
    // Custom override survives.
    const cfg = readJson(path.join(projectRoot, '.agentrc.json'));
    assert.equal(cfg.delivery.quality.codingGuardrails.cyclomaticFlag, 6);
    // Default-equal siblings were NOT seeded; the runtime resolves them
    // at read time.
    assert.equal(
      cfg.delivery.quality.codingGuardrails.cyclomaticMustFix,
      undefined,
    );
    assert.equal(cfg.delivery.quality.autoRefresh, undefined);
    // Default-equal writes are reported under skippedKeys.
    assert.ok(
      result.skippedKeys.some((k) => k.endsWith('cyclomaticMustFix')),
      'cyclomaticMustFix should be reported as skipped (matches framework default)',
    );
    assert.ok(
      result.skippedKeys.some((k) => k.endsWith('autoRefresh.enabled')),
      'autoRefresh.enabled should be reported as skipped (matches framework default)',
    );
    // addedKeys stays empty because every would-be write is default-equal.
    assert.deepEqual(result.addedKeys, []);
  });
});

describe('quality-bootstrap — degraded environments', () => {
  it('reports missing-source when the helper file is absent', () => {
    const projectRoot = makeProject();
    const emptyFramework = path.join(tmpRoot, '_empty-framework');
    fs.mkdirSync(emptyFramework, { recursive: true });
    const result = ensureGuardrailsHelper({
      projectRoot,
      frameworkRoot: emptyFramework,
    });
    assert.equal(result.action, 'missing-source');
  });

  it('reports missing-package-json when package.json is absent', () => {
    const projectRoot = makeProject({ packageJson: false });
    const result = ensureQualityNpmScripts({ projectRoot });
    assert.equal(result.action, 'missing-package-json');
  });

  it('reports missing-config when .agentrc.json is absent', () => {
    const projectRoot = makeProject({ agentrc: false });
    const result = ensureQualityConfigDefaults({ projectRoot });
    assert.equal(result.action, 'missing-config');
    assert.deepEqual(result.addedKeys, []);
  });
});

describe('quality-bootstrap — baselines merge driver (AC-6)', () => {
  // The git half is stubbed everywhere here: these assertions are about the
  // tracked `.gitattributes` line, and a real `git config` would write into
  // whatever repo the suite happens to run inside.
  const noGit = () => ({ status: 1, stdout: '', stderr: '' });

  const PRE_EXISTING = [
    '* text=auto eol=lf',
    '*.png binary',
    'docs/** linguist-documentation',
  ].join('\n');

  it('creates a .gitattributes carrying only the attribute line', () => {
    const projectRoot = makeProject();
    const result = ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });

    assert.equal(result.attributes, 'created');
    assert.equal(
      fs.readFileSync(path.join(projectRoot, '.gitattributes'), 'utf8'),
      `${BASELINE_MERGE_ATTRIBUTE}\n`,
    );
  });

  it('appends to an existing file, leaving every prior line untouched', () => {
    const projectRoot = makeProject();
    const target = path.join(projectRoot, '.gitattributes');
    fs.writeFileSync(target, `${PRE_EXISTING}\n`);

    const result = ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });
    assert.equal(result.attributes, 'appended');

    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(lines.slice(0, 3), PRE_EXISTING.split('\n'));
    assert.equal(
      lines.filter((l) => l === BASELINE_MERGE_ATTRIBUTE).length,
      1,
      'the attribute line appears exactly once',
    );
  });

  it('is idempotent — a second run reports already-present and changes no bytes', () => {
    const projectRoot = makeProject();
    const target = path.join(projectRoot, '.gitattributes');
    fs.writeFileSync(target, `${PRE_EXISTING}\n`);

    ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });
    const afterFirst = fs.readFileSync(target);

    const second = ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });
    assert.equal(second.action, 'already-present');
    assert.equal(second.attributes, 'already-present');
    assert.ok(fs.readFileSync(target).equals(afterFirst));
  });

  it('does not glue its line onto a file with no trailing newline', () => {
    const projectRoot = makeProject();
    const target = path.join(projectRoot, '.gitattributes');
    fs.writeFileSync(target, '*.png binary'); // no trailing \n
    ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(lines, ['*.png binary', BASELINE_MERGE_ATTRIBUTE]);
  });

  it('ignores a commented-out registration', () => {
    const projectRoot = makeProject();
    const target = path.join(projectRoot, '.gitattributes');
    fs.writeFileSync(target, `# ${BASELINE_MERGE_ATTRIBUTE}\n`);
    const result = ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });
    assert.equal(result.attributes, 'appended');
  });

  it('registers the per-clone driver config inside a git repo', () => {
    const projectRoot = makeProject();
    const calls = [];
    const spawnImpl = (_cmd, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'rev-parse') return { status: 0, stdout: '.git' };
      if (args.includes('--get')) return { status: 1, stdout: '' };
      return { status: 0, stdout: '' };
    };
    const result = ensureBaselineMergeDriver({ projectRoot, spawnImpl });
    assert.equal(result.config, 'set');
    assert.ok(
      calls.some((c) => c.includes('merge.mandrel-baseline.driver')),
      'sets the driver command for this clone',
    );
  });

  it('reports not-a-repo rather than failing outside a git repository', () => {
    const projectRoot = makeProject();
    const result = ensureBaselineMergeDriver({ projectRoot, spawnImpl: noGit });
    assert.equal(result.config, 'not-a-repo');
  });

  it('is wired into applyQualityBootstrap', () => {
    const projectRoot = makeProject();
    const result = applyQualityBootstrap({
      projectRoot,
      frameworkRoot,
      spawnImpl: noGit,
    });
    assert.ok(result.mergeDriver, 'the merge-driver step reports an outcome');
    assert.equal(result.mergeDriver.attributes, 'created');
  });
});
