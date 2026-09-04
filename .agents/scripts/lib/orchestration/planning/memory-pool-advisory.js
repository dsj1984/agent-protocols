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
 * Detection is filesystem-only — no child processes, no `gh` probes, no
 * network. Every failure path fails soft to "no pool, no recommendation": the
 * advisory can degrade the nudge, never a plan.
 *
 * Test seams: `cwd`, `env`, `fsImpl` (node:fs-compatible `statSync` /
 * `readdirSync` / `readFileSync`), `now`, and the two thresholds.
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

/** Recommend a consolidation pass once the pool holds more entries than this. */
const ENTRY_COUNT_CEILING = 100;

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
 * Read the consolidation stamp, returning its ISO timestamp or `null`.
 * A missing, unreadable, unparseable, or malformed stamp is indistinguishable
 * from "never consolidated" — all four mean the same thing to the advisory.
 *
 * @returns {string|null}
 */
function readStamp({ poolDir, fsImpl }) {
  try {
    const raw = fsImpl.readFileSync(path.join(poolDir, STAMP_FILENAME), 'utf8');
    const parsed = JSON.parse(raw);
    const value = parsed?.lastConsolidatedAt;
    if (typeof value !== 'string' || value.length === 0) return null;
    return Number.isNaN(Date.parse(value)) ? null : value;
  } catch {
    return null;
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
 * @param {number} [opts.entryCountCeiling]
 * @returns {{ present: boolean, entryCount: number, lastConsolidatedAt: string|null,
 *            recommend: boolean, reasons: string[] }}
 */
export function buildMemoryPoolAdvisory({
  cwd = process.cwd(),
  env = process.env,
  fsImpl = defaultFs,
  homedir,
  now = new Date(),
  staleAfterDays = STALE_AFTER_DAYS,
  entryCountCeiling = ENTRY_COUNT_CEILING,
} = {}) {
  const absent = (reason) => ({
    present: false,
    entryCount: 0,
    lastConsolidatedAt: null,
    recommend: false,
    reasons: [reason],
  });

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

  const lastConsolidatedAt = readStamp({ poolDir, fsImpl });
  const reasons = [];

  // An empty pool has nothing to consolidate, whatever the stamp says.
  if (entryCount === 0) {
    return {
      present: true,
      entryCount: 0,
      lastConsolidatedAt,
      recommend: false,
      reasons: ['memory pool is empty — nothing to consolidate'],
    };
  }

  if (lastConsolidatedAt === null) {
    reasons.push(
      'no consolidation stamp — this pool has never been consolidated',
    );
  } else {
    const ageDays =
      (new Date(now).getTime() - Date.parse(lastConsolidatedAt)) / MS_PER_DAY;
    if (ageDays > staleAfterDays) {
      reasons.push(
        `last consolidated ${Math.floor(ageDays)} days ago (over the ${staleAfterDays}-day threshold)`,
      );
    }
  }

  if (entryCount > entryCountCeiling) {
    reasons.push(
      `${entryCount} entries (over the ${entryCountCeiling}-entry threshold)`,
    );
  }

  return {
    present: true,
    entryCount,
    lastConsolidatedAt,
    recommend: reasons.length > 0,
    reasons:
      reasons.length > 0
        ? reasons
        : ['memory pool is within both freshness thresholds'],
  };
}
