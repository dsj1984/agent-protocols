/**
 * gate-surface.js — per-kind health of the measuring instruments themselves
 * (Story #4902).
 *
 * A baseline review that only reads the numbers cannot see the failure mode
 * that matters most: an instrument that is not measuring anything. A gate can
 * be unconfigured, its baseline file can be missing, it can be a **stub**
 * (committed with no rows and an all-zero rollup, so it passes every run
 * vacuously), it can be years stale, and its `ignoreGlobs` can name paths
 * that no longer exist — each of which reads as "green" from the gate's exit
 * code. This section reports all five as declarative fields.
 *
 * @module lib/audit-baselines/gate-surface
 */

import path from 'node:path';
import picomatch from 'picomatch';
import {
  ALL_KINDS,
  baselinePathFor,
  GATE_KINDS,
  KIND_SPECS,
  rollupOf,
} from './kinds.js';
import { ageInDays, listFilesUnder, readJsonFile } from './read.js';

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
 * Every `targetDirs` entry declared by any gate, deduplicated. This is the
 * file universe an `ignoreGlobs` entry is checked against — a glob that
 * matches nothing inside the dirs its own gate scans is dead weight.
 *
 * @param {object | null | undefined} quality
 * @returns {string[]}
 */
function declaredTargetDirs(quality) {
  const dirs = new Set();
  for (const kind of GATE_KINDS) {
    for (const dir of quality?.gates?.[kind]?.targetDirs ?? []) {
      if (typeof dir === 'string' && dir.length > 0) dirs.add(dir);
    }
  }
  return [...dirs].sort();
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
 * @param {{
 *   kind: string, quality: object, read: object, relPath: string,
 *   files: string[], now: Date,
 * }} args
 * @returns {object}
 */
function surfaceEntryFor({ kind, quality, read, relPath, files, now }) {
  const gateBlock = quality?.gates?.[kind] ?? null;
  const { exists, parsed, parseError } = read;
  const rows = parsed ? KIND_SPECS[kind].rows(parsed) : [];
  const rollup = rollupOf(parsed);
  const generatedAt =
    typeof parsed?.generatedAt === 'string' ? parsed.generatedAt : null;
  return {
    kind,
    surface: GATE_KINDS.includes(kind) ? 'gate' : 'ratchet',
    baselinePath: relPath,
    configured: gateBlock !== null && typeof gateBlock === 'object',
    baselineExists: exists,
    stub: isStubInstrument({ rowCount: rows.length, rollup }),
    rowCount: rows.length,
    generatedAt,
    staleDays: ageInDays(generatedAt, now),
    deadIgnoreGlobs: findDeadIgnoreGlobs(gateBlock?.ignoreGlobs, files),
    parseError,
  };
}

/**
 * Walk both halves of the gate surface — the closed `delivery.quality.gates`
 * kinds and the out-of-band ratchet baselines — and report each instrument's
 * health.
 *
 * @param {{ cwd: string, quality: object, now?: Date }} args
 * @returns {{ entries: object[], baselines: Map<string, object|null> }}
 *   `baselines` carries each parsed envelope forward so the hotspot, trend,
 *   and headroom sections never re-read a 650KB file off disk.
 */
export function buildGateSurface({ cwd, quality, now = new Date() }) {
  const files = declaredTargetDirs(quality).flatMap((dir) =>
    listFilesUnder(cwd, dir),
  );
  const entries = [];
  const baselines = new Map();
  for (const kind of ALL_KINDS) {
    const relPath = baselinePathFor(kind, quality);
    const read = readJsonFile(path.resolve(cwd, relPath));
    entries.push(surfaceEntryFor({ kind, quality, read, relPath, files, now }));
    baselines.set(kind, read.parsed);
  }
  return { entries, baselines };
}
