/**
 * engine.js — assemble the `/audit-baselines` evidence envelope
 * (Story #4902).
 *
 * Strictly read-only and strictly offline: it reads committed baselines, the
 * resolved config, git history, the static import graph, and any friction
 * ledger it finds. It never writes under `baselines/`, never refreshes a
 * baseline, and never runs a test, coverage, or mutation suite — the whole
 * point is that a baseline review costs a file read, not a CI run.
 *
 * Findings are evidence, not a verdict: assembling the envelope is success,
 * however alarming its contents, so the CLI exits 0 whenever it got this far.
 * Judgment belongs to the lens that reads the envelope.
 *
 * @module lib/audit-baselines/engine
 */

import path from 'node:path';
import { mainCheckoutRoot, tempRootFrom } from '../config/temp-paths.js';
import { getQuality, resolveConfig } from '../config-resolver.js';
import { buildGateSurface } from './gate-surface.js';
import { buildHeadroom } from './headroom.js';
import { buildHotspots } from './hotspots.js';
import { ALL_KINDS, baselinePathFor, GATE_KINDS } from './kinds.js';
import { DEFAULT_TOP_N, extractOutliers } from './outliers.js';
import { buildTrend } from './trend.js';
import {
  makeWeightResolver,
  readCentrality,
  readChurn,
  readFriction,
} from './weights.js';

/** Envelope `kind` discriminator; matches the shipped schema's const. */
const ENVELOPE_KIND = 'audit-baselines-envelope';

/** Envelope schema version — bumped on any breaking shape change. */
const ENVELOPE_SCHEMA_VERSION = '1';

/** Cap on emitted hotspot clusters, independent of the per-gate `topN`. */
export const DEFAULT_HOTSPOT_LIMIT = 50;

/**
 * Resolve the repository config without letting a broken `.agentrc.json`
 * abort the run — an unreadable config still leaves the baseline files
 * themselves readable at their default paths.
 *
 * @param {string} cwd
 * @returns {{ quality: object, configError: string | null }}
 */
function resolveQualityBlock(cwd) {
  try {
    return { quality: getQuality(resolveConfig({ cwd })), configError: null };
  } catch (err) {
    return { quality: { gates: {} }, configError: err?.message ?? String(err) };
  }
}

/**
 * Absolute temp root the friction ledger is searched under, anchored to the
 * **analysed** repository rather than the process cwd. `resolvedTempRoot()`
 * anchors to whichever checkout the current process sits in, which is the
 * right answer for a writer and the wrong one here: an engine pointed at
 * another repo with `--cwd` must read that repo's ledger, not this one's.
 *
 * @param {string} cwd
 * @returns {string}
 */
function tempRootFor(cwd) {
  let relative = 'temp';
  try {
    relative = tempRootFrom(resolveConfig({ cwd }));
  } catch {
    // Unreadable config — the framework default root is still worth probing.
  }
  if (path.isAbsolute(relative)) return relative;
  return path.join(mainCheckoutRoot(cwd) ?? cwd, relative);
}

/**
 * Run the engine and return the envelope object. Pure with respect to the
 * filesystem apart from the reads named in the module docstring — writing
 * the result is the caller's job.
 *
 * @param {{
 *   cwd: string,
 *   topN?: number,
 *   hotspotLimit?: number,
 *   trendDepth?: number,
 *   now?: Date,
 * }} args
 * @returns {object} the `audit-baselines-envelope`
 */
export function runEngine({
  cwd,
  topN = DEFAULT_TOP_N,
  hotspotLimit = DEFAULT_HOTSPOT_LIMIT,
  trendDepth = 5,
  now = new Date(),
}) {
  const { quality, configError } = resolveQualityBlock(cwd);
  const { entries, baselines } = buildGateSurface({ cwd, quality, now });

  const outliers = ALL_KINDS.flatMap((kind) =>
    extractOutliers({ kind, baseline: baselines.get(kind) ?? null, topN }),
  );

  const churn = readChurn({ cwd });
  const centrality = readCentrality({ cwd });
  const friction = readFriction({ tempRootAbs: tempRootFor(cwd) });

  return {
    kind: ENVELOPE_KIND,
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    cwd,
    topN,
    configError,
    degradations: {
      gitHistory: churn.degraded,
      importGraph: centrality.degraded,
      frictionLedger: friction.degraded,
    },
    gateSurface: entries,
    hotspots: buildHotspots({
      outliers,
      weightsFor: makeWeightResolver({ churn, centrality, friction }),
      limit: hotspotLimit,
    }),
    trend: buildTrend({
      cwd,
      kinds: ALL_KINDS,
      pathFor: (kind) => baselinePathFor(kind, quality),
      depth: trendDepth,
    }),
    headroom: buildHeadroom({ kinds: GATE_KINDS, quality, baselines }),
  };
}

/**
 * Condense an envelope into the pure-JSON stdout summary. Small enough to
 * read in a terminal, and never carrying a row set.
 *
 * @param {object} envelope
 * @param {string} outPath absolute path the full envelope was written to
 * @returns {object}
 */
export function summarize(envelope, outPath) {
  return {
    kind: 'audit-baselines-summary',
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    out: outPath,
    generatedAt: envelope.generatedAt,
    gateSurface: {
      total: envelope.gateSurface.length,
      configured: envelope.gateSurface.filter((g) => g.configured).length,
      missingBaseline: envelope.gateSurface
        .filter((g) => !g.baselineExists)
        .map((g) => g.kind),
      stubs: envelope.gateSurface.filter((g) => g.stub).map((g) => g.kind),
      deadIgnoreGlobs: envelope.gateSurface.reduce(
        (n, g) => n + g.deadIgnoreGlobs.length,
        0,
      ),
    },
    hotspots: {
      total: envelope.hotspots.length,
      multiGate: envelope.hotspots.filter((h) => h.gateCount > 1).length,
      top: envelope.hotspots
        .slice(0, 5)
        .map((h) => ({ path: h.path, gates: h.gateKinds, rank: h.rank })),
    },
    trend: { kinds: envelope.trend.length },
    headroom: { axes: envelope.headroom.length },
    degradations: envelope.degradations,
  };
}
