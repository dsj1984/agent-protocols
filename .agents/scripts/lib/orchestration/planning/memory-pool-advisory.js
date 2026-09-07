/**
 * memory-pool-advisory.js — the `/mandrel-plan` Phase 0 memory-hygiene advisory.
 *
 * Replaces the retired memory-freshness pre-flight (Story #2557 / #4414) in
 * the same slot, fixing both of that design's defects:
 *
 *   1. **Correct pool resolution.** The retired `resolveMemoryDir` built
 *      `~/.claude/projects/<github.repo>/memory/`, but harness project
 *      directories are **cwd-slugs** — the absolute cwd with every `/` and `.`
 *      replaced by `-` — so the old path never resolved in any consumer and
 *      the scan was a silent no-op everywhere.
 *   2. **A named consumer.** The retired scanner emitted a per-entry staleness
 *      verdict nothing read. This emits one advisory the `/mandrel-plan` spine
 *      surfaces at Gate #1, recommending `/memory-consolidate`.
 *
 * It also drops the semantic that made the old scanner unfixable: it renders
 * **no per-entry verdict at all**. A memory citing a closed issue is a
 * delivery retrospective whose subject is that issue — not a stale entry — and
 * only the attended `/memory-consolidate` pass, reading content, can tell the
 * difference. This module counts and stats; it never judges an entry.
 *
 * **Growth, never size (Story #5182).** The second arm used to be an absolute
 * ceiling of a hundred entries. A consolidation pass prefers `correct` over
 * `dead` by design, so a pool that crosses a fixed ceiling stays over it
 * forever: the nudge then fired on every plan however fresh the stamp, and a
 * permanent recommendation is one the operator learns to ignore. The arm now
 * measures **entries written since the last pass** — the one quantity a pass
 * actually resets, because Step 6 records the post-rewrite entry count in the
 * stamp as the next run's growth baseline.
 *
 * A stamp carrying a date but no usable `entryCount` (every stamp written
 * before that Story) leaves growth **unmeasured**. That is not
 * "never consolidated" — an operator did review the pool — so the growth arm
 * simply stays silent and only the age arm can speak, until the next pass
 * writes a baseline.
 *
 * Detection is filesystem-only — no child processes, no `gh` probes, no
 * network. Every failure path fails soft to "no pool, no recommendation": the
 * advisory can degrade the nudge, never a plan.
 *
 * Test seams: `cwd`, `env`, `fsImpl` (node:fs-compatible `statSync` /
 * `readdirSync` / `readFileSync`), `now`, and the two thresholds
 * (`staleAfterDays`, `growthDelta`).
 *
 * `buildMemoryPoolAdvisory` is the **only** export: the helpers below have no
 * caller outside this module, and exporting one solely for a test would add a
 * row to the `dead-exports-production` ratchet (the `buildUiSurfaceSignal`
 * precedent). Tests reach every branch through the seams above — do not
 * "fix" the missing exports.
 */

import * as defaultFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Recommend a consolidation pass once the stamp is this old. */
const STALE_AFTER_DAYS = 30;

/** Recommend a pass once this many entries were written since the last one. */
const GROWTH_DELTA = 25;

/** Stamp file written by `/memory-consolidate` after its operator gate. */
const STAMP_FILENAME = '.consolidation-stamp.json';

/** The index file is not itself a memory entry. */
const INDEX_FILENAME = 'MEMORY.md';

const MS_PER_DAY = 86_400_000;

/**
 * Slugify an absolute path the way the harness names its per-project
 * directories: every `/` and `.` becomes `-`. Verified against real
 * directories in `~/.claude/projects/` — a plain checkout and a worktree both
 * round-trip exactly.
 *
 * @param {string} absPath
 * @returns {string}
 */
function slugifyProjectPath(absPath) {
  return String(absPath ?? '').replace(/[/.]/g, '-');
}

/**
 * Resolve the memory pool directory for a working directory.
 *
 * `MANDREL_MEMORY_DIR` wins outright (operator override and test seam);
 * otherwise `~/.claude/projects/<cwd-slug>/memory/`.
 *
 * @param {{ cwd?: string, env?: Record<string,string|undefined>, homedir?: string }} [opts]
 * @returns {string|null} absolute pool path, or `null` when unresolvable
 */
function resolveMemoryPoolDir({ cwd, env = process.env, homedir } = {}) {
  const override = env?.MANDREL_MEMORY_DIR;
  if (typeof override === 'string' && override.length > 0) return override;

  const base = typeof cwd === 'string' && cwd.length > 0 ? cwd : null;
  if (!base) return null;

  const home =
    typeof homedir === 'string' && homedir.length > 0 ? homedir : os.homedir();
  if (!home) return null;

  return path.join(
    home,
    '.claude',
    'projects',
    slugifyProjectPath(base),
    'memory',
  );
}

/**
 * The growth baseline a stamp records: its entry count, or `null` when it
 * records none. `null` is *unmeasured*, never zero — a zero baseline would
 * score every entry in the pool as newly written.
 *
 * @param {unknown} count
 * @returns {number|null}
 */
function readBaseline(count) {
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/**
 * Read the consolidation stamp.
 *
 * `at` is the ISO timestamp of the last pass, or `null` when there was none:
 * a missing, unreadable, unparseable or date-less stamp is indistinguishable
 * from "never consolidated" — all four mean the same thing to the advisory.
 * A stamp whose date is unusable carries no baseline either, so `baseline`
 * follows it to `null` rather than describing a pass that cannot be dated.
 *
 * `baseline` is the entry count that pass left behind — the growth arm's
 * reference point. It is `null` on a stamp that predates Story #5182 (date
 * only) and on a malformed count, which reads as *unmeasured growth*, never
 * as zero growth: a `0` baseline would score the whole pool as new.
 *
 * @returns {{ at: string|null, baseline: number|null }}
 */
function readStamp({ poolDir, fsImpl }) {
  const unstamped = { at: null, baseline: null };
  try {
    const raw = fsImpl.readFileSync(path.join(poolDir, STAMP_FILENAME), 'utf8');
    const parsed = JSON.parse(raw);
    const at = parsed.lastConsolidatedAt;
    // `Date.parse` rejects the empty string as NaN, so this one test covers
    // both an absent date and an unusable one.
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      return unstamped;
    }
    return { at, baseline: readBaseline(parsed.entryCount) };
  } catch {
    return unstamped;
  }
}

/**
 * Count memory entries — `.md` files other than the index.
 *
 * @returns {number|null} `null` when the directory cannot be listed
 */
function countEntries({ poolDir, fsImpl }) {
  try {
    return fsImpl
      .readdirSync(poolDir)
      .filter((name) => name.endsWith('.md') && name !== INDEX_FILENAME).length;
  } catch {
    return null;
  }
}

/**
 * The advisory's field set, defaulted to the fail-soft "no usable pool"
 * reading. Every return path spreads its own findings over this, so the
 * envelope's shape is declared once — a new field cannot reach some callers
 * and not others, which is the failure mode a per-branch object literal has.
 *
 * @param {object} fields
 * @returns {{ present: boolean, entryCount: number, lastConsolidatedAt: string|null,
 *            entriesSinceConsolidation: number|null, recommend: boolean,
 *            reasons: string[] }}
 */
function envelope(fields) {
  return {
    present: false,
    entryCount: 0,
    lastConsolidatedAt: null,
    entriesSinceConsolidation: null,
    recommend: false,
    reasons: [],
    ...fields,
  };
}

/**
 * Collect the reasons a pool wants a consolidation pass. An empty array is
 * the quiet verdict; the caller turns it into `recommend` and supplies the
 * standing-down sentence, so every arm lives in one place.
 *
 * The two arms are independent and both are reported when both fire.
 *
 * @param {{ stamp: { at: string|null, baseline: number|null },
 *           growth: number|null, now: Date|string|number,
 *           staleAfterDays: number, growthDelta: number }} args
 * @returns {string[]}
 */
function collectReasons({ stamp, growth, now, staleAfterDays, growthDelta }) {
  const reasons = [];

  if (stamp.at === null) {
    reasons.push(
      'no consolidation stamp — this pool has never been consolidated',
    );
  } else {
    const ageDays =
      (new Date(now).getTime() - Date.parse(stamp.at)) / MS_PER_DAY;
    if (ageDays > staleAfterDays) {
      reasons.push(
        `last consolidated ${Math.floor(ageDays)} days ago (over the ${staleAfterDays}-day threshold)`,
      );
    }
  }

  // `growth === null` is unmeasured, not zero — a pre-#5182 stamp carries no
  // baseline, and guessing one would re-invent the ceiling this arm replaced.
  if (growth !== null && growth >= growthDelta) {
    reasons.push(
      `${growth} entries written since the last consolidation (at or over the ${growthDelta}-entry growth delta)`,
    );
  }

  return reasons;
}

/**
 * The sentence a quiet pool explains itself with — one per reason it is quiet,
 * so "nothing to do" never reads the same as "nothing measurable".
 *
 * @param {{ growth: number|null, growthDelta: number }} args
 * @returns {string}
 */
function quietReason({ growth, growthDelta }) {
  if (growth === null) {
    return 'memory pool is within the freshness threshold; growth is unmeasured until the next /memory-consolidate stamps an entry count';
  }
  return `memory pool is within both thresholds — ${growth} entries written since the last consolidation (under the ${growthDelta}-entry growth delta)`;
}

/**
 * Build the `memoryPoolAdvisory` envelope field.
 *
 * Advisory only — it carries **no routing authority**, mirroring
 * `deliverLightSuggestion`. The `/mandrel-plan` spine surfaces `recommend` at Gate #1;
 * nothing auto-runs, and nothing here mutates the operator's memory store.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd] — defaults to `process.cwd()`
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {object} [opts.fsImpl] — node:fs-compatible seam
 * @param {string} [opts.homedir]
 * @param {Date|string|number} [opts.now]
 * @param {number} [opts.staleAfterDays]
 * @param {number} [opts.growthDelta]
 * @returns {{ present: boolean, entryCount: number, lastConsolidatedAt: string|null,
 *            entriesSinceConsolidation: number|null, recommend: boolean,
 *            reasons: string[] }}
 */
export function buildMemoryPoolAdvisory({
  cwd = process.cwd(),
  env = process.env,
  fsImpl = defaultFs,
  homedir,
  now = new Date(),
  staleAfterDays = STALE_AFTER_DAYS,
  growthDelta = GROWTH_DELTA,
} = {}) {
  const absent = (reason) => envelope({ reasons: [reason] });

  const poolDir = resolveMemoryPoolDir({ cwd, env, homedir });
  if (!poolDir) {
    return absent(
      'no memory pool could be resolved for this working directory',
    );
  }

  let isDir = false;
  try {
    isDir = fsImpl.statSync(poolDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return absent(`no memory pool at ${poolDir} — nothing to consolidate`);
  }

  const entryCount = countEntries({ poolDir, fsImpl });
  if (entryCount === null) {
    return absent(`memory pool at ${poolDir} could not be listed`);
  }

  const stamp = readStamp({ poolDir, fsImpl });
  // Reported raw: a pruning pass can leave this negative, and saying the pool
  // shrank by 7 is more use to the operator than clamping it to zero.
  const growth = stamp.baseline === null ? null : entryCount - stamp.baseline;

  const found = {
    present: true,
    entryCount,
    lastConsolidatedAt: stamp.at,
    entriesSinceConsolidation: growth,
  };

  // An empty pool has nothing to consolidate, whatever the stamp says.
  if (entryCount === 0) {
    return envelope({
      ...found,
      reasons: ['memory pool is empty — nothing to consolidate'],
    });
  }

  const reasons = collectReasons({
    stamp,
    growth,
    now,
    staleAfterDays,
    growthDelta,
  });

  return envelope({
    ...found,
    recommend: reasons.length > 0,
    reasons:
      reasons.length > 0 ? reasons : [quietReason({ growth, growthDelta })],
  });
}
