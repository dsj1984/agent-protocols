/**
 * refresh-ack.js — the one-shot baseline refresh acknowledgment (Story #5179).
 *
 * Extracted from `evaluate.js`, where it grew from a bundle-size env flag
 * (Story #151) through a maintainability env-or-commit-tag pair (Story #4731)
 * into the kind-generic trigger (Story #4802). Story #5179 narrowed the
 * commit-tag arm from a whole-run blanket to the rows the tagged commit
 * actually refreshed, which is enough logic to own its own module.
 *
 * @module lib/orchestration/check-baselines/phases/refresh-ack
 */

import { resolveKindRefreshOverrides } from '../../../baselines/env-overrides.js';
import {
  readBaseFromGit,
  readRangeCommitsTouchingFile,
} from '../../../baselines/git-base.js';
import { getKindModule } from '../../../baselines/kernel.js';
import { Logger } from '../../../Logger.js';
import { applyTolerance } from './compare.js';
import { DEFAULT_BASELINE_PATHS } from './parse-args.js';

/** Default refresh-tag substring when the gate omits `refreshTag`. */
const DEFAULT_REFRESH_TAG = 'baseline-refresh:';

function resolveBaselinePath(kind, gateBlock) {
  const configured =
    typeof gateBlock?.baselinePath === 'string' && gateBlock.baselinePath.length
      ? gateBlock.baselinePath
      : null;
  return configured ?? DEFAULT_BASELINE_PATHS[kind] ?? null;
}

function resolveRefreshTag(gateBlock) {
  return typeof gateBlock?.refreshTag === 'string' &&
    gateBlock.refreshTag.length
    ? gateBlock.refreshTag
    : DEFAULT_REFRESH_TAG;
}

/**
 * Resolve the one-shot refresh trigger for any ratcheted kind. Two paths, either
 * of which acknowledges:
 *
 *   1. Env parity: `<KIND>_REFRESH=1` (the manual override) — upper-snaked, so
 *      the two pre-existing names (`BUNDLE_SIZE_REFRESH`,
 *      `MAINTAINABILITY_REFRESH`) keep working unchanged.
 *   2. Commit tag: a commit in the compared range `<baseRef>..HEAD` whose
 *      subject contains the configured `refreshTag` AND whose diff touches that
 *      kind's baseline file. One-shot by construction — once merged, the
 *      refreshed baseline becomes the base and the tag leaves the range.
 *
 * The tag is matched as a plain substring of a conventional commit subject, so
 * commitlint stays satisfied (e.g. `chore(baselines): baseline-refresh: …`).
 *
 * The two arms are reported separately because Story #5179 scopes them
 * differently: see `applyRefreshAcknowledgment`.
 *
 * Fails closed: a kind whose baseline path is neither configured nor present in
 * `DEFAULT_BASELINE_PATHS` simply skips the commit-tag path rather than
 * throwing, leaving that arm un-acknowledged.
 *
 * @returns {{ triggered: boolean, reasons: string[], envAcknowledged: boolean,
 *   refreshCommits: { sha: string, subject: string }[], baselinePath: string | null }}
 */
function resolveRefreshTrigger({ kind, gateBlock, cmp, cwd, env }) {
  const reasons = [];
  const { acknowledged: envAcknowledged, overrides } =
    resolveKindRefreshOverrides(kind, env);
  if (envAcknowledged) reasons.push(...overrides);

  const baselinePath = resolveBaselinePath(kind, gateBlock);
  const refreshCommits = [];
  const baseRef = cmp?.baseRef ?? null;
  if (baseRef && typeof baselinePath === 'string' && baselinePath.length) {
    const refreshTag = resolveRefreshTag(gateBlock);
    const commits = readRangeCommitsTouchingFile(baseRef, baselinePath, {
      cwd,
    });
    for (const commit of commits) {
      if (!commit.subject.includes(refreshTag)) continue;
      refreshCommits.push(commit);
      reasons.push(
        `refresh commit "${commit.subject}" (subject contains ${JSON.stringify(refreshTag)}, touches ${baselinePath})`,
      );
    }
  }

  return {
    triggered: reasons.length > 0,
    reasons,
    envAcknowledged,
    refreshCommits,
    baselinePath,
  };
}

/**
 * Read the baseline rows as of one refresh commit. Returns `null` — never
 * throws and never a partial row set — when the blob is absent, unreadable or
 * unparseable at that SHA. The caller treats `null` as "this commit
 * acknowledges nothing", which keeps the ratchet at full strength rather than
 * acknowledging on a guess.
 */
function readRowsAtCommit(sha, baselinePath, cwd) {
  let raw;
  try {
    raw = readBaseFromGit(sha, baselinePath, { cwd });
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const payload = JSON.parse(raw);
    return Array.isArray(payload?.rows) ? payload.rows : null;
  } catch {
    return null;
  }
}

/**
 * Build the row set the refresh commits collectively vouch for, keyed by the
 * kind's own `keyField`.
 *
 * `readRangeCommitsTouchingFile` returns newest-first, so the first commit to
 * claim a key wins: when two tagged commits both rewrote a row, the newest is
 * the state the branch is actually asking to be held to.
 */
function collectRefreshedRows({ keyField, refreshCommits, baselinePath, cwd }) {
  const byKey = new Map();
  for (const { sha } of refreshCommits) {
    const rows = readRowsAtCommit(sha, baselinePath, cwd);
    if (rows === null) continue;
    for (const row of rows) {
      const key = row?.[keyField];
      if (typeof key !== 'string' || byKey.has(key)) continue;
      byKey.set(key, row);
    }
  }
  return byKey;
}

/**
 * Which regression keys are acknowledgeable by the tagged commits (Story #5179)?
 *
 * The acknowledgment is a statement about what a refresh commit re-scored, so a
 * key is acknowledgeable only when BOTH hold:
 *
 *   1. **Row membership** — the key exists in the baseline blob at a refresh
 *      commit's own SHA. A key absent there was never refreshed by that commit,
 *      and demoting it was the larger half of the leak: a single tagged commit
 *      cleared regressions on rows in directories it never touched.
 *   2. **No post-refresh drift** — the head row is no worse than what that
 *      commit recorded. Drift introduced by commits landing AFTER the refresh is
 *      exactly what "the baseline commit must be the branch's last score-moving
 *      commit" asks for by convention and nothing enforced.
 *
 * Test 2 delegates direction to the kind module's own `compare()` rather than
 * re-deriving `betterWhen`: a second implementation of higher-is-better could
 * disagree with the classifier that produced the regressions in the first
 * place, and a gate whose two halves disagree fails open. Note `compare` files
 * a head row with no base row under `additions`, not `regressions`, which is
 * precisely why test 1 is a separate membership check and not an inference from
 * test 2's output.
 *
 * The gate's own `tolerance` is applied to the drift compare as well. Without
 * it this check would be STRICTER than the ratchet it guards — a sub-tolerance
 * wiggle against the refreshed row would block a branch that the same wiggle
 * against the base ref would wave through — and the two halves of a gate that
 * disagree on what counts as movement is the bug class this Story exists to
 * close, not one to reintroduce.
 *
 * Fails closed at every step: an unreadable blob, a missing `compare`, or a
 * classifier that throws yields an empty set, so every regression stands.
 *
 * @returns {Set<string>}
 */
function acknowledgeableKeys({
  kind,
  headBaseline,
  refreshCommits,
  baselinePath,
  cwd,
  tolerance,
}) {
  if (refreshCommits.length === 0) return new Set();
  if (typeof baselinePath !== 'string' || baselinePath.length === 0)
    return new Set();

  let mod;
  try {
    mod = getKindModule(kind);
  } catch {
    return new Set();
  }
  if (typeof mod?.keyField !== 'string' || typeof mod.compare !== 'function')
    return new Set();

  const refreshedByKey = collectRefreshedRows({
    keyField: mod.keyField,
    refreshCommits,
    baselinePath,
    cwd,
  });
  if (refreshedByKey.size === 0) return new Set();

  const headRows = Array.isArray(headBaseline?.rows) ? headBaseline.rows : [];
  let drifted;
  try {
    const result = mod.compare(
      { rows: headRows },
      { rows: [...refreshedByKey.values()] },
    );
    const tolerated = applyTolerance(
      {
        regressions: result?.regressions ?? [],
        improvements: result?.improvements ?? [],
        unchanged: result?.unchanged ?? [],
        additions: result?.additions ?? [],
      },
      tolerance ?? null,
    );
    drifted = new Set(tolerated.regressions.map((r) => r.key));
  } catch {
    return new Set();
  }

  const acknowledgeable = new Set();
  for (const key of refreshedByKey.keys()) {
    if (!drifted.has(key)) acknowledgeable.add(key);
  }
  return acknowledgeable;
}

function partitionRegressions(regressions, isAcknowledgeable) {
  const acknowledged = [];
  const kept = [];
  for (const reg of regressions) {
    if (isAcknowledgeable(reg)) acknowledged.push(reg);
    else kept.push(reg);
  }
  return { acknowledged, kept };
}

function logAcknowledgment({ kind, reasons, acknowledged, kept }) {
  const held =
    kept.length > 0
      ? `${kept.length} regression(s) NOT acknowledged (outside the refreshed rows, or drifted further after the refresh) and still fail the gate; `
      : '';
  Logger.warn(
    `[${kind}] ⚠ ${reasons.join('; ')} — ` +
      `${acknowledged.length} regression(s) acknowledged for this run only; ` +
      `${held}floors still enforced. This does not persist: once the refresh is ` +
      'the new base the ratchet re-enforces at full strength.',
  );
}

/**
 * One-shot baseline refresh/acknowledge for any ratcheted kind. When triggered,
 * demote acknowledged head-vs-base regressions to `unchanged` for this run only
 * — floors still apply, so a row below its floor still breaches. The trigger is
 * read fresh every run and never persisted: post-merge the refreshed baseline is
 * the new base and the tag leaves the range, so the ratchet returns to full
 * strength automatically.
 *
 * The two trigger arms are scoped differently, deliberately:
 *
 * - **Commit tag** — scoped to the rows the tagged commits actually refreshed,
 *   per `acknowledgeableKeys`. Before Story #5179 this cleared every regression
 *   in the range, so a branch merged carrying a stale row and the ratchet ran
 *   loose on that file; the failure recurred six times.
 * - **Env parity** (`<KIND>_REFRESH=1`) — stays whole-run. There is no commit to
 *   anchor row-scoping to, and setting the variable is an explicit, deliberate
 *   operator act rather than a signal inferred from history.
 *
 * A no-op absent a trigger, so an unacknowledged run of any kind reports its
 * regressions exactly as before.
 *
 * @returns {{ compareOutput: object, acknowledged: boolean, acknowledgedKeys: string[] }}
 */
export function applyRefreshAcknowledgment(kind, compareOutput, ctx) {
  const trigger = resolveRefreshTrigger({ ...ctx, kind });
  if (!trigger.triggered || compareOutput.regressions.length === 0) {
    return { compareOutput, acknowledged: false, acknowledgedKeys: [] };
  }

  let isAcknowledgeable;
  if (trigger.envAcknowledged) {
    isAcknowledgeable = () => true;
  } else {
    const keys = acknowledgeableKeys({
      kind,
      headBaseline: ctx.headBaseline,
      refreshCommits: trigger.refreshCommits,
      baselinePath: trigger.baselinePath,
      cwd: ctx.cwd,
      tolerance: ctx.gateBlock?.tolerance ?? null,
    });
    isAcknowledgeable = (reg) => keys.has(reg.key);
  }

  const { acknowledged, kept } = partitionRegressions(
    compareOutput.regressions,
    isAcknowledgeable,
  );
  if (acknowledged.length === 0) {
    return { compareOutput, acknowledged: false, acknowledgedKeys: [] };
  }

  logAcknowledgment({ kind, reasons: trigger.reasons, acknowledged, kept });

  return {
    acknowledged: true,
    acknowledgedKeys: acknowledged.map((reg) => reg.key),
    compareOutput: {
      ...compareOutput,
      regressions: kept,
      unchanged: [...compareOutput.unchanged, ...acknowledged],
    },
  };
}
