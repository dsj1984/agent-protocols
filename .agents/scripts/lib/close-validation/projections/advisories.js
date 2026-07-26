// .agents/scripts/lib/close-validation/projections/advisories.js
/**
 * advisories.js — the projection layer's single call site (Story #4776).
 *
 * `projections/maintainability.js` shipped fully written, fully unit-tested
 * and imported by nothing: the v2 Epic-tier collapse removed its caller and
 * left the module behind. The practical consequence was that the advisory
 * telling an operator to run `npm run maintainability:update` and commit a
 * `baseline-refresh:` subject had never fired in v2 — consumers refreshed
 * their baselines by hand or not at all.
 *
 * This module is that caller, for both projections. It is deliberately the
 * only door: `close-validation/runner.js` invokes `runProjectionAdvisories`
 * once, after the gate chain has passed, and every per-kind concern (gate
 * enablement, baseline path resolution, scorer construction, formatting)
 * lives here rather than being re-derived at the runner boundary.
 *
 * **Advisory, always.** Nothing in here can fail a close. `check-baselines`
 * already fails closed on a real regression; the projections add the refresh
 * half of the loop, not a second gate. Every projection is wrapped so a
 * throw becomes a logged skip.
 */

import path from 'node:path';
import { getQuality } from '../../config/quality.js';
import {
  createCrapScorer,
  formatCrapProjection,
  projectCrapBreaches,
} from './crap.js';
import {
  formatMaintainabilityProjection,
  projectMaintainabilityRegressions,
} from './maintainability.js';

/** Default on-disk baseline locations, mirroring the per-gate defaults. */
const DEFAULT_BASELINE_PATHS = Object.freeze({
  maintainability: 'baselines/maintainability.json',
  crap: 'baselines/crap.json',
});

/**
 * Resolve a gate's baseline file to an absolute path.
 *
 * @param {string} kind
 * @param {object} gate resolved `delivery.quality.gates.<kind>` block
 * @param {string} cwd
 * @returns {string}
 */
function resolveBaselinePath(kind, gate, cwd) {
  const rel =
    typeof gate?.baselinePath === 'string' && gate.baselinePath.length > 0
      ? gate.baselinePath
      : DEFAULT_BASELINE_PATHS[kind];
  return path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
}

/**
 * A gate is projected unless it is explicitly disabled. An absent gate
 * block means "framework defaults", which enable it — the same reading
 * `buildDefaultGates` applies.
 *
 * @param {object|undefined} gate
 * @returns {boolean}
 */
function isEnabled(gate) {
  return gate?.enabled !== false;
}

/**
 * Run one projection with its formatter, swallowing every failure into a
 * logged skip. Returns the projection result (or `null` when it threw) so
 * callers and tests can inspect what happened without parsing log lines.
 *
 * @param {{ kind: string, log: (m: string) => void, run: () => Promise<object>|object, format: (r: object) => string|null }} opts
 * @returns {Promise<object|null>}
 */
async function runOne({ kind, log, run, format }) {
  let result;
  try {
    result = await run();
  } catch (err) {
    log(
      `[close-validation]   ⚠ ${kind} projection skipped (errored): ${err?.message ?? err}`,
    );
    return null;
  }
  if (result?.skipped) {
    log(
      `[close-validation] ⏭ ${kind} projection skipped (${result.skipped}${
        result.detail ? `: ${result.detail}` : ''
      })`,
    );
    return result;
  }
  const advisory = format(result);
  if (advisory) log(advisory);
  return result;
}

/**
 * Run the maintainability and CRAP pre-merge projections and log their
 * advisories. Never throws; never affects the close verdict.
 *
 * @param {{
 *   cwd: string,
 *   baseBranch: string,
 *   storyBranch: string,
 *   config?: object,
 *   quality?: object,
 *   log?: (m: string) => void,
 *   projectMaintainability?: typeof projectMaintainabilityRegressions,
 *   formatMaintainability?: typeof formatMaintainabilityProjection,
 *   projectCrap?: typeof projectCrapBreaches,
 *   formatCrap?: typeof formatCrapProjection,
 * }} opts
 * @returns {Promise<{ maintainability: object|null, crap: object|null }>}
 */
export async function runProjectionAdvisories({
  cwd,
  baseBranch,
  storyBranch,
  config,
  quality,
  log = () => {},
  projectMaintainability = projectMaintainabilityRegressions,
  formatMaintainability = formatMaintainabilityProjection,
  projectCrap = projectCrapBreaches,
  formatCrap = formatCrapProjection,
} = {}) {
  const out = { maintainability: null, crap: null };
  let gates;
  try {
    gates = quality ?? getQuality(config) ?? {};
  } catch {
    gates = {};
  }

  const miGate = gates.maintainability;
  if (isEnabled(miGate)) {
    out.maintainability = await runOne({
      kind: 'maintainability',
      log,
      format: formatMaintainability,
      run: () =>
        projectMaintainability({
          cwd,
          baseBranch,
          storyBranch,
          baselinePath: resolveBaselinePath('maintainability', miGate, cwd),
        }),
    });
  } else {
    log('[close-validation] ⏭ maintainability projection skipped (disabled)');
  }

  const crapGate = gates.crap;
  if (isEnabled(crapGate)) {
    out.crap = await runOne({
      kind: 'crap',
      log,
      format: formatCrap,
      run: () =>
        projectCrap({
          cwd,
          baseBranch,
          storyBranch,
          baselinePath: resolveBaselinePath('crap', crapGate, cwd),
          newMethodCeiling: crapGate?.newMethodCeiling,
          scoreFiles: createCrapScorer({
            cwd,
            targetDirs: crapGate?.targetDirs,
            ignoreGlobs: crapGate?.ignoreGlobs,
            requireCoverage: crapGate?.requireCoverage,
            coveragePath: crapGate?.coveragePath,
          }),
        }),
    });
  } else {
    log('[close-validation] ⏭ crap projection skipped (disabled)');
  }

  return out;
}
