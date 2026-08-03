/**
 * gate-surface.js — walk both halves of the baseline surface (Story #4902).
 *
 * The closed `delivery.quality.gates` kinds and the out-of-band ratchet
 * baselines are one surface, and an engine that walks only the first silently
 * drops the second. This module owns that walk and the file universe an
 * `ignoreGlobs` entry is checked against; [`surface-entry.js`](surface-entry.js)
 * turns each kind into its health report.
 *
 * @module lib/audit-baselines/gate-surface
 */

import path from 'node:path';
import { ALL_KINDS, baselinePathFor, GATE_KINDS } from './kinds.js';
import { listFilesUnder, readJsonFile } from './read.js';
import { surfaceEntryFor } from './surface-entry.js';

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
 * Walk both halves of the gate surface — the closed `delivery.quality.gates`
 * kinds and the out-of-band ratchet baselines — and report each instrument's
 * health.
 *
 * @param {{ cwd: string, quality: object, now?: Date, run?: Function }} args
 *   `run` overrides the git spawn; `staleness.js` owns the real default.
 * @returns {{ entries: object[], baselines: Map<string, object|null> }}
 *   `baselines` carries each parsed envelope forward so the hotspot, trend,
 *   and headroom sections never re-read a 650KB file off disk.
 */
export function buildGateSurface({ cwd, quality, now = new Date(), run }) {
  const files = declaredTargetDirs(quality).flatMap((dir) =>
    listFilesUnder(cwd, dir),
  );
  const io = { cwd, run };
  const entries = [];
  const baselines = new Map();
  for (const kind of ALL_KINDS) {
    const relPath = baselinePathFor(kind, quality);
    const read = readJsonFile(path.resolve(cwd, relPath));
    entries.push(
      surfaceEntryFor({ kind, quality, read, relPath, files, now, io }),
    );
    baselines.set(kind, read.parsed);
  }
  return { entries, baselines };
}
