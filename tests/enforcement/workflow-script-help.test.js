/**
 * tests/enforcement/workflow-script-help.test.js
 *
 * Story #4750 — every orchestration script a workflow tells an agent to run
 * must be self-describing.
 *
 * ## The rule
 *
 * For each `.agents/scripts/*.js` path referenced by any file under
 * `.agents/workflows/`, `node <script> --help` must:
 *
 *   1. exit 0 — `--help` is a query, never an error path; and
 *   2. write non-empty text to **stdout** (not stderr, and not swallowed by
 *      `AGENT_LOG_LEVEL=silent`).
 *
 * ## Why the set is derived, not listed
 *
 * A hard-coded adoption list is a second place to remember, which is the exact
 * failure this Story exists to remove: the flag contract used to live in the
 * workflow prose that invoked the script, and drifted from the script. Grepping
 * the workflows means a newly-invoked script fails this test until it answers
 * `--help` — the guard grows with the corpus instead of rotting next to it.
 *
 * ## Why the side-effect half is structural, not asserted here
 *
 * "`--help` performs no GitHub write, acquires no lease, and mutates no
 * working tree" is enforced by construction: `runAsCli` (`lib/cli-utils.js`)
 * answers help **before** invoking `main`, so no script body runs at all. The
 * `respondToHelp`-before-`main` ordering is unit-tested in
 * `tests/lib/cli-usage.test.js`; here we assert the observable half plus the
 * one thing a subprocess can see cheaply — that the run left the working tree
 * clean.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertDocMentions,
  assertDocOmits,
  readDoc,
} from '../helpers/doc-assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.agents', 'workflows');
const SCRIPTS_DIR = path.join(REPO_ROOT, '.agents', 'scripts');

/** Matches `.agents/scripts/<name>.js` — top-level CLIs only, not `lib/`. */
const SCRIPT_REF_RE = /\.agents\/scripts\/([A-Za-z0-9_-]+)\.js/g;

function listMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdown(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * The adoption set: every top-level script named by a workflow document and
 * present on disk. Sorted so failures read in a stable order.
 *
 * @returns {string[]} Script basenames, e.g. `single-story-init.js`.
 */
export function deriveWorkflowInvokedScripts() {
  const names = new Set();
  for (const doc of listMarkdown(WORKFLOWS_DIR)) {
    const source = fs.readFileSync(doc, 'utf8');
    for (const match of source.matchAll(SCRIPT_REF_RE)) {
      const file = `${match[1]}.js`;
      if (fs.existsSync(path.join(SCRIPTS_DIR, file))) names.add(file);
    }
  }
  return [...names].sort();
}

const ADOPTION_SET = deriveWorkflowInvokedScripts();

/** `git status --porcelain`, as a set of path entries. */
function worktreeStatus() {
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'git status failed');
  return (status.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes(' temp/'))
    .sort();
}

// Captured at module load — i.e. before any `--help` subprocess runs — so the
// comparison at the end measures what the help runs did, not how dirty the
// checkout happened to be when the suite started.
const STATUS_BEFORE = worktreeStatus();

describe('workflow-invoked scripts are self-describing', () => {
  it('derives a non-empty adoption set from the workflow corpus', () => {
    assert.ok(
      ADOPTION_SET.length > 0,
      'no .agents/scripts/*.js references found under .agents/workflows/ — the ' +
        'grep that derives this guard has stopped matching',
    );
    // Spot-check the derivation rather than pinning a count: a Story that adds
    // or retires a workflow invocation must not have to edit this test.
    assert.ok(
      ADOPTION_SET.includes('single-story-init.js'),
      'expected the deliver path to still invoke single-story-init.js',
    );
  });

  for (const script of ADOPTION_SET) {
    it(`${script} answers --help on stdout with exit 0`, () => {
      const result = spawnSync(
        process.execPath,
        [path.join(SCRIPTS_DIR, script), '--help'],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 60_000,
          // `silent` proves help does not ride on Logger.info: a script that
          // routes its usage block through the logger prints nothing here.
          env: { ...process.env, AGENT_LOG_LEVEL: 'silent' },
        },
      );

      assert.equal(
        result.status,
        0,
        `${script} --help exited ${result.status} (signal ${result.signal}).\n` +
          `stderr: ${(result.stderr ?? '').slice(0, 800)}`,
      );
      assert.ok(
        (result.stdout ?? '').trim().length > 0,
        `${script} --help wrote nothing to stdout. A workflow-invoked script ` +
          'must document its own flags — add a `usage:` spec to its runAsCli ' +
          'call (see .agents/scripts/lib/cli-usage.js).',
      );
    });
  }

  it('does not re-inline a flag enumeration the script now owns', () => {
    // Story #4750 deleted these three; each is a verbatim restatement of a
    // flag surface `--help` prints, and each is the shape most likely to be
    // pasted back in by a well-meaning edit. Wrap-independent by construction
    // (`assertDocOmits` normalizes) so a re-flow cannot hide a regression.
    const deliverStory = readDoc(
      path.join(WORKFLOWS_DIR, 'helpers', 'deliver-story.md'),
    );
    assertDocOmits(
      deliverStory,
      /Flags: `--dry-run`/,
      'single-story-init.js documents --dry-run / --steal itself — deliver-story.md must not restate them',
    );
    assertDocMentions(
      deliverStory,
      /documents its own flags — run it with `--help`/,
      "deliver-story.md must point the reader at each script's own --help",
    );

    const plan = readDoc(path.join(WORKFLOWS_DIR, 'plan.md'));
    for (const flag of [
      '--chain-on-clean',
      '--no-close-superseded',
      '--route-downgrade-reason',
      '--allow-over-budget',
    ]) {
      assertDocOmits(
        plan,
        new RegExp(`\\| \`${flag}`),
        `plan.md's flag table must not restate plan-persist.js's ${flag} — the CLI documents it`,
      );
    }

    const gitCleanup = readDoc(path.join(WORKFLOWS_DIR, 'git-cleanup.md'));
    assertDocMentions(
      gitCleanup,
      /git-cleanup\.js --help/,
      'git-cleanup.md must point at the script for its flag list',
    );
  });

  it('leaves the working tree exactly as it found it', () => {
    assert.deepEqual(
      worktreeStatus(),
      STATUS_BEFORE,
      '`--help` mutated the working tree. A help branch must short-circuit ' +
        'before any write — check that the script routes help through ' +
        "runAsCli's `usage` option rather than a check inside main().",
    );
  });
});

/**
 * Story #4872 — the baseline updaters performed a real baseline write when
 * asked for their usage. They are named explicitly here (rather than left to
 * the derived adoption set above) because for a CLI whose whole job is to
 * mutate, "a usage probe leaves the artifact byte-identical" is the
 * load-bearing half of the contract, not an incidental one — and the derived
 * set only covers them for as long as some workflow happens to cite them.
 */
const MUTATING_UPDATERS = [
  'update-coverage-baseline.js',
  'update-crap-baseline.js',
  'update-duplication-baseline.js',
  'update-maintainability-baseline.js',
];

/** `{ relPath: sha-ish content }` for every committed baseline file. */
function snapshotBaselines() {
  const dir = path.join(REPO_ROOT, 'baselines');
  const snapshot = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    snapshot[entry.name] = fs.readFileSync(path.join(dir, entry.name));
  }
  return snapshot;
}

describe('baseline updaters answer --help without writing a baseline', () => {
  for (const script of MUTATING_UPDATERS) {
    it(`${script} --help prints usage, exits 0, and mutates no baseline`, () => {
      const before = snapshotBaselines();
      const result = spawnSync(
        process.execPath,
        [path.join(SCRIPTS_DIR, script), '--help'],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 120_000,
          env: { ...process.env, AGENT_LOG_LEVEL: 'silent' },
        },
      );

      assert.equal(
        result.status,
        0,
        `${script} --help exited ${result.status}.\nstderr: ${(result.stderr ?? '').slice(0, 800)}`,
      );
      assert.ok(
        (result.stdout ?? '').trim().length > 0,
        `${script} --help wrote nothing to stdout`,
      );

      const after = snapshotBaselines();
      assert.deepEqual(
        Object.keys(after).sort(),
        Object.keys(before).sort(),
        `${script} --help added or removed a baseline file`,
      );
      for (const [name, bytes] of Object.entries(before)) {
        assert.ok(
          bytes.equals(after[name]),
          `${script} --help rewrote baselines/${name} — a usage probe must not mutate the artifact it describes`,
        );
      }
    });
  }
});
