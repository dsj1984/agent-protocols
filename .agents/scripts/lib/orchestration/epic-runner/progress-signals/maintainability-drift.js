import nodeFs from 'node:fs';
import path from 'node:path';

import { calculateForSource } from '../../../maintainability-engine.js';

const DEFAULT_THRESHOLD = 2.0;
const BASELINE_FILENAME = 'maintainability-baseline.json';

/**
 * Detects per-file maintainability drop versus a wave-start baseline.
 *
 * Usage:
 *   const detector = createMaintainabilityDriftDetector({ cwd, files });
 *   detector.captureBaseline();   // call once at wave-start
 *   await detector.detect(rows);  // call each progress fire
 *
 * A baseline is a map of file -> score, persisted to
 * `<cwd>/<baselineDir>/maintainability-baseline.json` so that a resumed epic
 * run can re-read the snapshot from the previous wave rather than lose the
 * anchor. Any file whose score has dropped by >= `threshold` since baseline
 * is surfaced as a bullet:
 *
 *   📉 Maintainability drift: <file> -<n.nn> vs wave-start baseline
 *
 * Errors while reading/scoring individual files are swallowed — a single
 * bad file must not take the progress reporter down.
 *
 * @param {{
 *   cwd?: string,
 *   files?: string[],               // files to watch; repo-relative paths
 *   fs?: { readFileSync: Function, writeFileSync?: Function, mkdirSync?: Function, existsSync?: Function },
 *   calculate?: (source: string) => number,
 *   threshold?: number,             // drop (baseline - current) that trips a bullet
 *   baselineDir?: string,           // directory (under cwd) to persist snapshot
 * }} [opts]
 */
export function createMaintainabilityDriftDetector(opts = {}) {
  const fs = opts.fs ?? nodeFs;
  const cwd = opts.cwd ?? process.cwd();
  const files = Array.isArray(opts.files) ? [...opts.files] : [];
  const calculate = opts.calculate ?? calculateForSource;
  const threshold = Number.isFinite(opts.threshold)
    ? opts.threshold
    : DEFAULT_THRESHOLD;
  const baselineDir = opts.baselineDir ?? '.agents/state';
  const baselinePath = path.join(cwd, baselineDir, BASELINE_FILENAME);

  let baseline = null;

  function scoreFile(relPath) {
    try {
      const abs = path.join(cwd, relPath);
      const src = fs.readFileSync(abs, 'utf-8');
      const score = calculate(src);
      return Number.isFinite(score) ? score : null;
    } catch {
      return null;
    }
  }

  return {
    get baselinePath() {
      return baselinePath;
    },

    captureBaseline() {
      const snapshot = {};
      for (const f of files) {
        const s = scoreFile(f);
        if (s != null) snapshot[f] = s;
      }
      baseline = snapshot;
      if (fs.writeFileSync) {
        try {
          fs.mkdirSync?.(path.dirname(baselinePath), { recursive: true });
          fs.writeFileSync(
            baselinePath,
            JSON.stringify({ capturedAt: new Date().toISOString(), scores: snapshot }, null, 2),
          );
        } catch {
          // persistence is best-effort; the in-memory baseline still works
        }
      }
      return snapshot;
    },

    loadBaseline() {
      if (!fs.readFileSync) return null;
      try {
        const raw = fs.readFileSync(baselinePath, 'utf-8');
        const parsed = JSON.parse(raw);
        baseline = parsed?.scores ?? null;
        return baseline;
      } catch {
        return null;
      }
    },

    async detect() {
      if (!baseline) return [];
      const bullets = [];
      for (const [relPath, baseScore] of Object.entries(baseline)) {
        const current = scoreFile(relPath);
        if (current == null) continue;
        const drop = baseScore - current;
        if (drop >= threshold) {
          bullets.push(
            `📉 Maintainability drift: ${relPath} -${drop.toFixed(2)} vs wave-start baseline`,
          );
        }
      }
      return bullets;
    },
  };
}
