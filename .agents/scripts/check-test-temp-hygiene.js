#!/usr/bin/env node

/**
 * Test-temp hygiene guard (Story #4696).
 *
 * The friction / lifecycle / trace NDJSON streams under `temp/` are the
 * substrate every retro, rollup, and loop-health consumer reads. When the
 * test suite appends fixture records to the *real* `temp/` tree (the #4555
 * defect class, re-surfaced for the signal writers), those consumers read
 * noise: at the time this guard shipped, 99% of friction records were
 * test-fixture pollution.
 *
 * The writer-layer fix (`lib/config/temp-paths.js` scratch seam +
 * `lib/test-env.js` bootstrap) redirects stray test writes into an absolute
 * per-process scratch dir. This script is the regression guard that keeps
 * the fix honest, plus a local cleanup mode for the accumulated noise:
 *
 * The guard covers two distinct temp roots, and conflating them is how the
 * second one went unmeasured for so long:
 *
 *   1. The repo's own `temp/` telemetry tree — the original dimension above.
 *   2. The **OS temp root** (Story #4808). The redirect in (1) sends stray
 *      writes into `os.tmpdir()` scratch dirs, and nothing ever reaped them:
 *      the remedy for (1) became the largest single leaker into (2). Since
 *      the damaging axis there is entry *count*, the suite now nests every
 *      managed dir inside one per-process `mandrel-suite-*` root
 *      (`lib/test-temp.js`) and reaps it, and this guard asserts that no
 *      such root survives a run.
 *
 *   --snapshot         Record a fingerprint (size + sha256) of every stream
 *                      file under `temp/`, plus the `mandrel-suite-*` roots
 *                      already present in the OS temp root, to the snapshot
 *                      baseline. Run this before the suite.
 *   --assert           Re-scan and fail if any stream file was added or grew
 *                      relative to the snapshot, or if a suite root appeared
 *                      and survived. Run this after the suite. A missing
 *                      snapshot is a hard failure ("snapshot missing
 *                      — guard cannot attest"), never a silent re-baseline:
 *                      the baseline lives *outside* the protected `temp/`
 *                      tree (Story #4711), so a test wiping `temp/` can no
 *                      longer destroy the baseline and fail the guard open.
 *                      Recording pre-existing suite roots (rather than
 *                      asserting an empty set) is what keeps a concurrent
 *                      suite in another checkout from failing this one.
 *   --lint-globs <g>   Comma-separated repo-relative globs to scan for test
 *                      files that call `mkdtemp` against `os.tmpdir()`
 *                      directly instead of going through `makeTempDir`.
 *                      **Off unless passed**: this script ships in the
 *                      materialized `.agents/` payload and a consumer's
 *                      tests are none of this rule's business. A line (or
 *                      the line above it) carrying `test-temp-allow` opts
 *                      out.
 *   --baseline <path>  Explicit snapshot-baseline path (CI sets this to a
 *                      runner-temp path). Defaults to an OS scratch location
 *                      keyed by the resolved repo root. Refused when it
 *                      resolves inside the protected `temp/` tree.
 *   --clean            List stream directories whose Epic/Story id matches a
 *                      known fixture id (report-only; nothing is deleted).
 *   --clean --yes      Delete those directories.
 *   --ids 1,2,3        Override the fixture-id list for --clean.
 *   --root <dir>       Operate against <dir> instead of the repo root
 *                      (its `temp/` subtree). Used by tests.
 *
 * Exit codes: 1 on an --assert failure (a new / grown stream file, or a
 * missing snapshot baseline); 0 otherwise.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAsCli } from './lib/cli-utils.js';
import { mainCheckoutRoot } from './lib/config/temp-paths.js';
import {
  isReservedTestId,
  RESERVED_TEST_ID_BAND,
} from './lib/reserved-test-ids.js';
import {
  findRawTmpdirMkdtemp,
  listSuiteTempRoots,
  SUITE_ROOTS_KEY,
  survivingSuiteTempRoots,
} from './lib/test-temp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Known fixture Epic/Story ids observed polluting the real `temp/` tree
 * (Story #4696). `--clean` targets only these by default so real scratch
 * (a genuine `run-<id>` from a live delivery) is never swept.
 */
export const KNOWN_FIXTURE_STORY_IDS = Object.freeze([
  4428, 10, 4242, 5, 42, 100, 555, 2839, 4257, 4258, 4259,
]);

/**
 * Resolve the `temp/` directory for a given repo root.
 * @param {string} repoRoot
 * @returns {string}
 */
export function tempDirFor(repoRoot) {
  return path.join(repoRoot, 'temp');
}

/**
 * Default snapshot-baseline path for a repo root — deliberately *outside*
 * the protected `temp/` tree (Story #4711). The pre-#4711 baseline lived at
 * `temp/.test-temp-hygiene-snapshot.json`, inside the very tree the guard
 * protects: a test (or cleanup) that wiped `temp/` destroyed the baseline
 * and the post-test `--assert` silently re-baselined the pollution. The
 * default now lives under the OS scratch dir, keyed by the resolved repo
 * root so parallel checkouts / worktrees never collide.
 *
 * @param {string} repoRoot
 * @returns {string}
 */
export function defaultBaselinePath(repoRoot) {
  const key = createHash('sha256')
    .update(path.resolve(repoRoot))
    .digest('hex')
    .slice(0, 16);
  return path.join(
    os.tmpdir(),
    'mandrel-test-temp-hygiene',
    `snapshot-${key}.json`,
  );
}

/**
 * Refuse a baseline path that resolves inside the protected `temp/` tree —
 * storing the attestation inside the tree it attests recreates the
 * fail-open gap this Story closes.
 *
 * @param {string} repoRoot
 * @param {string} baselinePath
 * @returns {string} the resolved baseline path
 */
function checkedBaselinePath(repoRoot, baselinePath) {
  const resolved = path.resolve(baselinePath);
  const tempDir = path.resolve(tempDirFor(repoRoot));
  if (resolved === tempDir || resolved.startsWith(tempDir + path.sep)) {
    throw new Error(
      `[test-temp-hygiene] baseline path must live outside the protected temp/ tree; got ${resolved}`,
    );
  }
  return resolved;
}

/**
 * Is `rel` (a path relative to `temp/`, POSIX-normalised) a telemetry stream
 * file we guard? Stream files are `*.ndjson` living under a `run-<id>/`
 * subtree or the `standalone/stories/` subtree.
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function isStreamFile(rel) {
  if (!rel.endsWith('.ndjson')) return false;
  const first = rel.split('/')[0];
  if (/^run-\d+$/.test(first)) return true;
  return rel.startsWith('standalone/stories/');
}

/**
 * Recursively list every stream file under `tempDir`, returned as
 * POSIX-normalised paths relative to `tempDir`, sorted for determinism.
 *
 * @param {string} tempDir
 * @returns {string[]}
 */
export function listStreamFiles(tempDir) {
  if (!existsSync(tempDir)) return [];
  /** @type {string[]} */
  const out = [];
  const walk = (absDir, relDir) => {
    for (const ent of readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, ent.name);
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(abs, rel);
      } else if (ent.isFile() && isStreamFile(rel)) {
        out.push(rel);
      }
    }
  };
  walk(tempDir, '');
  return out.sort();
}

/**
 * Fingerprint a single file by byte length + sha256 of its contents.
 * @param {string} absPath
 * @returns {{ size: number, sha256: string }}
 */
export function fingerprintFile(absPath) {
  const buf = readFileSync(absPath);
  return {
    size: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

/**
 * Build a `{ [relPath]: fingerprint }` manifest of every stream file under
 * `tempDir`.
 * @param {string} tempDir
 * @returns {Record<string, { size: number, sha256: string }>}
 */
export function buildManifest(tempDir) {
  /** @type {Record<string, { size: number, sha256: string }>} */
  const manifest = {};
  for (const rel of listStreamFiles(tempDir)) {
    manifest[rel] = fingerprintFile(path.join(tempDir, rel));
  }
  return manifest;
}

/**
 * Persist the current manifest to the baseline path (default: the external
 * `defaultBaselinePath` — never inside `temp/`).
 * @param {string} repoRoot
 * @param {string} [baselinePath]
 * @param {{ tmpDir?: string }} [deps] Injectable OS temp root for tests.
 * @returns {{ snapshotPath: string, count: number, suiteRoots: number }}
 */
export function writeSnapshot(repoRoot, baselinePath, { tmpDir } = {}) {
  const snapshotPath = checkedBaselinePath(
    repoRoot,
    baselinePath ?? defaultBaselinePath(repoRoot),
  );
  const manifest = buildManifest(tempDirFor(repoRoot));
  const count = Object.keys(manifest).length;
  // Reserved key: stream entries are always `*.ndjson` relative paths, so
  // this cannot shadow one, and `diffAgainstSnapshot` only ever looks up
  // keys derived from the tree it just walked.
  manifest[SUITE_ROOTS_KEY] = listSuiteTempRoots(tmpDir ?? os.tmpdir());
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    snapshotPath,
    count,
    suiteRoots: manifest[SUITE_ROOTS_KEY].length,
  };
}

/**
 * Load the persisted manifest, or `null` when no snapshot exists.
 * @param {string} repoRoot
 * @param {string} [baselinePath]
 * @returns {Record<string, { size: number, sha256: string }> | null}
 */
export function readSnapshot(repoRoot, baselinePath) {
  const snapshotPath = checkedBaselinePath(
    repoRoot,
    baselinePath ?? defaultBaselinePath(repoRoot),
  );
  if (!existsSync(snapshotPath)) return null;
  return JSON.parse(readFileSync(snapshotPath, 'utf8'));
}

/**
 * Diff the current stream tree against a snapshot manifest.
 *
 * `added`   — stream files present now but absent from the snapshot.
 * `changed` — stream files whose size or sha256 differs from the snapshot
 *             (i.e. a test grew or rewrote an existing stream).
 *
 * A file that shrank or vanished is not a pollution signal, so it is ignored.
 *
 * @param {string} tempDir
 * @param {Record<string, { size: number, sha256: string }>} snapshot
 * @returns {{ added: string[], changed: string[] }}
 */
export function diffAgainstSnapshot(tempDir, snapshot) {
  const current = buildManifest(tempDir);
  const added = [];
  const changed = [];
  for (const [rel, fp] of Object.entries(current)) {
    const prior = snapshot[rel];
    if (!prior) {
      added.push(rel);
    } else if (prior.size !== fp.size || prior.sha256 !== fp.sha256) {
      changed.push(rel);
    }
  }
  return { added: added.sort(), changed: changed.sort() };
}

/**
 * Extract the fixture-matching id from a top-level `temp/` entry name, or
 * `null` when the entry is not an id-keyed stream directory.
 *
 * `run-<id>` maps to `<id>`; the `standalone/stories/story-<id>` shape is
 * handled by the caller (it recurses one level deeper).
 *
 * @param {string} name
 * @returns {number|null}
 */
function runDirId(name) {
  const m = /^run-(\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Locate stream directories whose Epic/Story id is in `ids`.
 *
 * Two shapes are swept: `temp/run-<id>/` (Epic-scoped) and
 * `temp/standalone/stories/story-<id>/` (standalone Story-scoped).
 *
 * @param {string} tempDir
 * @param {ReadonlySet<number>} ids
 * @returns {{ id: number, kind: 'run' | 'standalone-story', rel: string }[]}
 */
export function findFixtureDirs(tempDir, ids) {
  if (!existsSync(tempDir)) return [];
  const found = [];
  for (const ent of readdirSync(tempDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const id = runDirId(ent.name);
    if (id !== null && ids.has(id)) {
      found.push({ id, kind: 'run', rel: ent.name });
    }
  }
  const storiesDir = path.join(tempDir, 'standalone', 'stories');
  if (existsSync(storiesDir)) {
    for (const ent of readdirSync(storiesDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const m = /^story-(\d+)$/.exec(ent.name);
      const id = m ? Number(m[1]) : null;
      if (id !== null && ids.has(id)) {
        found.push({
          id,
          kind: 'standalone-story',
          rel: `standalone/stories/${ent.name}`,
        });
      }
    }
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Report (and optionally delete) fixture-id stream directories.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {Iterable<number>} [opts.ids]
 * @param {boolean} [opts.apply=false] delete when true; report-only otherwise.
 * @returns {{ candidates: { id: number, kind: string, rel: string }[], removed: string[] }}
 */
export function cleanFixtureDirs({
  repoRoot,
  ids = KNOWN_FIXTURE_STORY_IDS,
  apply = false,
}) {
  const tempDir = tempDirFor(repoRoot);
  const candidates = findFixtureDirs(tempDir, new Set(ids));
  const removed = [];
  if (apply) {
    for (const c of candidates) {
      rmSync(path.join(tempDir, c.rel), { recursive: true, force: true });
      removed.push(c.rel);
    }
  }
  return { candidates, removed };
}

/**
 * Every Epic / Story id a stream file's own path attributes it to.
 *
 * Both canonical layouts are read, and a nested Epic-attached stream yields
 * both ids (`run-<eid>/stories/story-<sid>/…`): either half being a fixture id
 * makes the stream fixture-owned, and taking only the outer one is how a
 * fixture Story under a real run would slip past.
 *
 * @param {string} rel POSIX-normalised path relative to `temp/`.
 * @returns {number[]}
 */
function streamOwnerIds(rel) {
  const ids = [];
  const run = /^run-(\d+)$/.exec(rel.split('/')[0]);
  if (run) ids.push(Number(run[1]));
  const story = /(?:^|\/)story-(\d+)\//.exec(rel);
  if (story) ids.push(Number(story[1]));
  return ids;
}

/**
 * Stream files under `tempDir` owned by a **reserved test-fixture id**
 * (Story #4892).
 *
 * This is the residual-pollution dimension the snapshot/assert bracket cannot
 * cover: the bracket only runs in CI, where `temp/` starts empty, so a local
 * run that appends fixture telemetry to the operator's live ledger was only
 * ever discovered from the ticket the retro graduator filed off it (issue
 * #4870 cited `#999999`, a `--story 999999` CLI spawn from the suite).
 *
 * Unlike the snapshot diff this needs no baseline and is immune to a
 * concurrent delivery in another checkout: a reserved id is reserved *from*
 * real work, so nothing but a test can own one of these files.
 *
 * @param {string} tempDir
 * @returns {string[]} POSIX-normalised paths relative to `tempDir`, sorted.
 */
export function findReservedIdStreamFiles(tempDir) {
  return listStreamFiles(tempDir).filter((rel) =>
    streamOwnerIds(rel).some(isReservedTestId),
  );
}

/**
 * Post-run guard: fail when a test run left a fixture-id telemetry stream in
 * the **repository-root** temp tree (Story #4892).
 *
 * Resolution matters more than it looks: every writer anchors a relative
 * `tempRoot` to the *main checkout* (so a Story worktree and its `/deliver`
 * host converge on one ledger), so a guard that scanned `cwd` would scan an
 * empty worktree tree and pass vacuously on the very tree it is meant to
 * protect. `resolveRoot` is the injection seam for tests.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd=process.cwd()]
 * @param {(line: string) => void} [opts.log]
 * @param {(cwd: string) => string|null} [opts.resolveRoot]
 * @returns {number} exit code (0 clean, 1 polluted).
 */
export function assertNoReservedIdStreams({
  cwd = process.cwd(),
  log = (l) => process.stderr.write(`${l}\n`),
  resolveRoot = mainCheckoutRoot,
} = {}) {
  const root = resolveRoot(cwd) ?? cwd;
  const tempDir = tempDirFor(root);
  const found = findReservedIdStreamFiles(tempDir);
  if (found.length === 0) return 0;
  log(
    `[test-temp-hygiene] FAIL — ${found.length} fixture-id telemetry stream(s) in the real temp tree (${tempDir}):`,
  );
  for (const rel of found) log(`  + fixture ${rel}`);
  log(
    `[test-temp-hygiene] ids ${RESERVED_TEST_ID_BAND} are reserved for fixtures, so a test wrote to the live ledger — the retro graduator reads these streams and files tickets off them. Inject an absolute per-test tempRoot on the offending spawn, then remove the stream(s) with --clean --ids <id> --yes.`,
  );
  return 1;
}

/**
 * Parse the CLI argv into a normalised options object.
 * @param {string[]} argv
 * @returns {{ mode: 'snapshot'|'assert'|'clean', apply: boolean, ids: number[]|null, repoRoot: string, baseline: string|null, lintGlobs: string[] }}
 */
export function parseArgv(argv) {
  let mode = 'assert';
  let apply = false;
  let ids = null;
  let repoRoot = REPO_ROOT;
  let baseline = null;
  let lintGlobs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--snapshot') mode = 'snapshot';
    else if (arg === '--assert') mode = 'assert';
    else if (arg === '--clean') mode = 'clean';
    else if (arg === '--yes') apply = true;
    else if (arg === '--lint-globs') {
      i += 1;
      lintGlobs = String(argv[i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--ids') {
      i += 1;
      ids = String(argv[i] ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    } else if (arg === '--root') {
      i += 1;
      repoRoot = path.resolve(String(argv[i] ?? '.'));
    } else if (arg === '--baseline') {
      i += 1;
      baseline = path.resolve(String(argv[i] ?? '.'));
    }
  }
  return { mode, apply, ids, repoRoot, baseline, lintGlobs };
}

/**
 * Execute the guard for a parsed options object. Returns the process exit
 * code (0 = clean / snapshot recorded; 1 = pollution detected under
 * --assert). Printing is done via the injectable `log`.
 *
 * @param {ReturnType<typeof parseArgv>} opts
 * @param {(line: string) => void} [log]
 * @param {{ tmpDir?: string }} [deps] Injectable OS temp root for tests.
 * @returns {number}
 */
export function runHygiene(
  opts,
  log = (l) => process.stdout.write(`${l}\n`),
  { tmpDir = os.tmpdir() } = {},
) {
  const { mode, apply, ids, repoRoot, baseline = null, lintGlobs = [] } = opts;
  if (mode === 'snapshot') {
    const { snapshotPath, count, suiteRoots } = writeSnapshot(
      repoRoot,
      baseline,
      { tmpDir },
    );
    log(
      `[test-temp-hygiene] snapshot recorded (${count} stream file(s), ${suiteRoots} pre-existing suite root(s)) → ${snapshotPath}`,
    );
    return 0;
  }
  if (mode === 'clean') {
    const { candidates } = cleanFixtureDirs({
      repoRoot,
      ids: ids ?? KNOWN_FIXTURE_STORY_IDS,
      apply,
    });
    if (candidates.length === 0) {
      log('[test-temp-hygiene] no fixture-id stream directories found.');
      return 0;
    }
    log(
      `[test-temp-hygiene] ${candidates.length} fixture-id stream director(y/ies)${
        apply ? ' removed' : ' (report-only; pass --yes to delete)'
      }:`,
    );
    for (const c of candidates) {
      log(`  - ${c.rel} (id ${c.id}, ${c.kind})`);
    }
    return 0;
  }
  // mode === 'assert'
  const snapshotPath = baseline ?? defaultBaselinePath(repoRoot);
  const snapshot = readSnapshot(repoRoot, snapshotPath);
  if (snapshot === null) {
    log(
      `[test-temp-hygiene] FAIL — snapshot missing (${path.resolve(snapshotPath)}); guard cannot attest. Run --snapshot before the suite (never re-baseline at assert time).`,
    );
    return 1;
  }
  // Every dimension runs and reports; a failure in one must not hide a
  // failure in another, so the exit code is the max rather than an
  // early return.
  const codes = [
    assertStreamTree(repoRoot, snapshot, log),
    assertNoSurvivingSuiteRoots(snapshot, log, tmpDir),
    assertNoRawTmpdirMkdtemp(repoRoot, lintGlobs, log),
  ];
  return Math.max(...codes);
}

/**
 * Dimension 1 — the repo's own `temp/` telemetry tree (Story #4696).
 *
 * @param {string} repoRoot
 * @param {Record<string, unknown>} snapshot
 * @param {(line: string) => void} log
 * @returns {number} exit code
 */
function assertStreamTree(repoRoot, snapshot, log) {
  const { added, changed } = diffAgainstSnapshot(
    tempDirFor(repoRoot),
    snapshot,
  );
  if (added.length === 0 && changed.length === 0) {
    log('[test-temp-hygiene] OK — no new or grown stream files under temp/.');
    return 0;
  }
  log(
    '[test-temp-hygiene] FAIL — the test suite polluted the real temp/ tree:',
  );
  for (const rel of added) log(`  + new    ${rel}`);
  for (const rel of changed) log(`  ~ grew   ${rel}`);
  log(
    '[test-temp-hygiene] a writer bypassed the scratch seam. Inject an absolute per-test tempRoot; do not weaken this guard.',
  );
  return 1;
}

/**
 * Dimension 2 — the OS temp root (Story #4808). Fails when a suite root
 * appeared since the snapshot and is still on disk, which means the run
 * created it and never reaped it.
 *
 * @param {Record<string, unknown>} snapshot
 * @param {(line: string) => void} log
 * @param {string} tmpDir
 * @returns {number} exit code
 */
function assertNoSurvivingSuiteRoots(snapshot, log, tmpDir) {
  const before = Array.isArray(snapshot[SUITE_ROOTS_KEY])
    ? snapshot[SUITE_ROOTS_KEY]
    : [];
  const surviving = survivingSuiteTempRoots(tmpDir, before);
  if (surviving.length === 0) {
    log('[test-temp-hygiene] OK — no suite temp roots survived the run.');
    return 0;
  }
  log(
    `[test-temp-hygiene] FAIL — ${surviving.length} suite temp root(s) survived in ${tmpDir}:`,
  );
  for (const name of surviving) log(`  + leaked ${name}`);
  log(
    '[test-temp-hygiene] a process minted a suite root and exited without reaping it. Do not delete these by hand — find the writer that bypassed makeTempDir().',
  );
  return 1;
}

/**
 * Dimension 3 — the static backstop (Story #4808). Skipped, and reported
 * as skipped, unless the caller passed `--lint-globs`.
 *
 * @param {string} repoRoot
 * @param {string[]} globs
 * @param {(line: string) => void} log
 * @returns {number} exit code
 */
function assertNoRawTmpdirMkdtemp(repoRoot, globs, log) {
  if (!globs || globs.length === 0) {
    log(
      '[test-temp-hygiene] SKIP — raw-tmpdir lint not requested (pass --lint-globs to enable).',
    );
    return 0;
  }
  const findings = findRawTmpdirMkdtemp(repoRoot, globs);
  if (findings.length === 0) {
    log(
      '[test-temp-hygiene] OK — no test file mints OS temp dirs outside makeTempDir().',
    );
    return 0;
  }
  log(
    `[test-temp-hygiene] FAIL — ${findings.length} raw os.tmpdir() mkdtemp call(s) in test files:`,
  );
  for (const f of findings) log(`  ${f.file}:${f.line}  ${f.text}`);
  log(
    "[test-temp-hygiene] use makeTempDir() from .agents/scripts/lib/test-temp.js so teardown is registered, or mark the line 'test-temp-allow: <reason>' when the real root is genuinely required.",
  );
  return 1;
}

runAsCli(
  import.meta.url,
  async () => {
    const code = runHygiene(parseArgv(process.argv.slice(2)));
    return code;
  },
  {
    source: 'check-test-temp-hygiene',
    propagateExitCode: true,
    usage: {
      invocation:
        'node .agents/scripts/check-test-temp-hygiene.js [--snapshot | --assert | --clean] [--baseline <path>] [--lint-globs <globs>] [--ids <ids>] [--root <dir>]',
      summary:
        'Regression guard for test-fixture pollution of the temp trees: the repo temp/ telemetry streams every retro reads, and the OS temp root the suite scratch dirs nest under.',
      flags: [
        [
          '--snapshot',
          'Fingerprint every temp/ stream file and the pre-existing OS suite roots. Run BEFORE the suite.',
        ],
        [
          '--assert',
          'Re-scan and fail on any stream added or grown, or a surviving suite root. Run AFTER the suite. This is the default when no mode flag is passed.',
        ],
        [
          '--clean',
          'List stream directories whose Epic/Story id matches a known fixture id. Report-only — deletes nothing.',
        ],
        [
          '--baseline <path>',
          'Explicit snapshot path (CI sets a runner-temp path). Defaults to an OS scratch location keyed by the repo root; refused inside the protected temp/ tree.',
        ],
        [
          '--lint-globs <globs>',
          'Comma-separated repo-relative globs scanned for tests calling mkdtemp against os.tmpdir() instead of makeTempDir(). Off unless passed.',
        ],
        ['--ids <ids>', 'Comma-separated fixture ids for --clean.'],
        ['--root <dir>', 'Repository root to scan (default: repo root).'],
      ],
      notes: [
        '--assert requires a snapshot recorded by an earlier --snapshot run: a missing one is a hard failure, never a silent re-baseline.',
        'Exit codes:\n  0  clean\n  1  a breach, or --assert with no snapshot to attest against',
      ],
    },
  },
);
