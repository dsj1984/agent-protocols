/**
 * surface-entry.js — the health report for one measuring instrument
 * (Story #4902, split out in #4962).
 *
 * A baseline review that only reads the numbers cannot see the failure mode
 * that matters most: an instrument that is not measuring anything. A gate can
 * be unconfigured, its baseline file can be missing, it can be a **stub**
 * (committed with no rows and an all-zero rollup, so it passes every run
 * vacuously), it can be stale on either clock, and its `ignoreGlobs` can name
 * paths that no longer exist — each of which reads as "green" from the gate's
 * exit code. This module turns all of that into declarative fields for one
 * kind; [`gate-surface.js`](gate-surface.js) walks the kinds and
 * [`staleness.js`](staleness.js) owns the two clocks.
 *
 * @module lib/audit-baselines/surface-entry
 */

import picomatch from 'picomatch';
import { GATE_KINDS, KIND_SPECS, measuredTotalOf, rollupOf } from './kinds.js';
import { stalenessOf } from './staleness.js';

/**
 * True when every numeric leaf of the rollup is zero. A rollup with no
 * numeric leaves at all is not all-zero — it carries no measurement to call
 * zero, and treating it as such would flag shapes this engine cannot read.
 *
 * @param {object | null} rollup
 * @returns {boolean}
 */
function isAllZeroRollup(rollup) {
  if (!rollup || typeof rollup !== 'object') return false;
  const numbers = Object.values(rollup).filter((v) => typeof v === 'number');
  return numbers.length > 0 && numbers.every((v) => v === 0);
}

/**
 * A **stub instrument**: zero rows AND an all-zero rollup. Both halves are
 * required. Ratchet baselines carry no rollup, so a clean `arch-cycles`
 * allowlist — genuinely zero cycles, the success state — is never mistaken
 * for a dead instrument.
 *
 * @param {{ rowCount: number, rollup: object | null }} args
 * @returns {boolean}
 */
function isStubInstrument({ rowCount, rollup }) {
  return rowCount === 0 && isAllZeroRollup(rollup);
}

/**
 * Which of a gate's configured `ignoreGlobs` match zero files on disk.
 *
 * @param {string[]} ignoreGlobs
 * @param {string[]} files repo-relative posix paths
 * @returns {string[]}
 */
function findDeadIgnoreGlobs(ignoreGlobs, files) {
  const dead = [];
  for (const glob of ignoreGlobs ?? []) {
    if (typeof glob !== 'string' || glob.length === 0) continue;
    const isMatch = picomatch(glob, { dot: true });
    if (!files.some((f) => isMatch(f))) dead.push(glob);
  }
  return dead;
}

/**
 * Assemble one `gateSurface[]` entry from an already-read baseline.
 *
 * `rowCount` and `measured` both appear because they legitimately disagree:
 * rows are counted after the kind's per-file aggregation, while `measured` is
 * the quantity the instrument reports in its own unit — 589 dead-export
 * symbols sit in 187 files.
 *
 * @param {{
 *   kind: string, quality: object, read: object, relPath: string,
 *   files: string[], now: Date, io: { cwd: string, run?: Function },
 * }} args
 * @returns {object}
 */
export function surfaceEntryFor({
  kind,
  quality,
  read,
  relPath,
  files,
  now,
  io,
}) {
  const gateBlock = quality?.gates?.[kind] ?? null;
  const { exists, parsed: baseline, parseError } = read;
  const rows = baseline ? KIND_SPECS[kind].rows(baseline) : [];
  const rollup = rollupOf(baseline);
  return {
    kind,
    surface: GATE_KINDS.includes(kind) ? 'gate' : 'ratchet',
    baselinePath: relPath,
    configured: gateBlock !== null && typeof gateBlock === 'object',
    baselineExists: exists,
    stub: isStubInstrument({ rowCount: rows.length, rollup }),
    rowCount: rows.length,
    measured: measuredTotalOf(kind, baseline),
    ...stalenessOf({ kind, gateBlock, rows, relPath, baseline, now, io }),
    deadIgnoreGlobs: findDeadIgnoreGlobs(gateBlock?.ignoreGlobs, files),
    parseError,
  };
}
