#!/usr/bin/env node
/**
 * pr-watch-with-update.js — the single CI-watch mechanism for the Story
 * delivery path (`helpers/deliver-story.md` Step 4). Story #4358 retired
 * the bare `gh pr checks --watch` so every caller drives this one CLI.
 *
 * Polls the PR's required checks to a terminal state and auto-recovers
 * from `mergeStateStatus: BEHIND` (via bounded `gh pr update-branch`
 * calls) by delegating to the shared `watchPrToTerminal` primitive in
 * the lifecycle `Watcher` — the SAME loop the listener runs, so the CLI
 * and the bus path are byte-for-byte equivalent. No lifecycle bus is
 * created; this is a direct, synchronous watch with a real exit code.
 *
 * Slow-vs-failed semantics (Story #4358):
 *   - GREEN — every required check terminal + green → exit 0, unless the
 *             no-rerun guard says otherwise (below).
 *   - RED   — one or more required checks genuinely failed → exit 1
 *             IMMEDIATELY, consuming no resume budget. On red the CLI
 *             disarms native auto-merge and writes
 *             `temp/story-<id>-ci-digest.{json,md}` (failing check name,
 *             head SHA, run id + run link, a `gh run view --log-failed`
 *             tail, and a coarse classification). The digest is scoped by
 *             filename, so it requires `--story` (Story #4539: the digest
 *             was Epic-scoped and therefore never written on the only
 *             delivery path v2 has).
 *   - STILL-RUNNING — the poll cap fired with checks still pending and
 *             none failed; the watcher re-armed up to
 *             `delivery.ci.watch.maxResumes` times, then returned a
 *             `still-running` verdict → exit 2 (NEVER 1, NEVER
 *             `timed_out`). The CLI prints the `gh pr checks --watch`
 *             handoff so the host can keep polling on its own cadence.
 *   - UNRESOLVED — every observed required check is green but the observed
 *             set does not reconcile with the repository's own verdict
 *             (Story #4873) → exit 2, same "keep watching" semantics as
 *             still-running. Withholding is the point: this watcher has
 *             reported green on a PR GitHub was reporting as BLOCKED.
 *
 * Two GitHub oracles are deliberately not trusted on a single reading
 * (Story #4873). An EMPTY first `gh pr checks --required` probe is retried
 * within {@link REQUIRED_CONTEXT_ATTACH_WINDOW_MS} before it is believed —
 * a ruleset attaches its required contexts tens of seconds after a PR opens,
 * and a watch launched right after `gh pr create` used to fail the delivery
 * on that empty probe. And a GREEN verdict is issued only after
 * {@link reconcileGreenVerdict} confirms the repository agrees; an
 * unreconcilable set reports unresolved instead of green.
 *
 * No-rerun enforcement (Story #4865). `rules/ci-remediation.md` § Verifier
 * forbids re-running a failed job to reach green; this CLI is the point
 * that enforces it. Enforcement acts on the **first red** — GitHub's native
 * auto-merge fires server-side and races any post-green detection, so a
 * green can already have merged by the time it is observed. On red the
 * watcher disarms auto-merge and records the head SHA; on green it reads
 * the digest and adjudicates: a green on the SAME head SHA is a forbidden
 * re-run (exit 1, `agent::blocked`, `meta::framework-gap` required), while
 * a green on a NEW head SHA is a fix at source — the digest is retired,
 * auto-merge is re-armed, and the delivery proceeds. A delivery that never
 * went red has no digest and is untouched. Mechanism:
 * `lib/orchestration/ci-rerun-guard.js`.
 *
 * Config (Story #4356 namespace, read via `getCiDelivery`):
 *   - `delivery.ci.watch.pollIntervalMs`
 *   - `delivery.ci.watch.maxPolls`
 *   - `delivery.ci.watch.maxResumes`
 *   CLI flags override config; config overrides the framework fallback.
 *
 * Usage:
 *   node .agents/scripts/pr-watch-with-update.js --pr <n> --story <id>
 *     [--repo owner/repo] [--max-updates N] [--poll-interval-ms MS]
 *     [--max-polls N] [--max-resumes N]
 */
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { getCiDelivery } from './lib/config/ci.js';
import { resolveConfig } from './lib/config-resolver.js';
import { gh as defaultGh } from './lib/gh-exec.js';
import { Logger } from './lib/Logger.js';
import {
  blockStoryDelivery,
  classifyFailure,
  classifyGreenVerdict,
  disarmAutoMerge,
  formatRerunViolation,
  readCiDigest,
  resolveDigestScope,
  resolvePrHeadSha,
  retireCiDigest,
  writeCiDigest,
} from './lib/orchestration/ci-rerun-guard.js';
import { watchPrToTerminal } from './lib/orchestration/lifecycle/listeners/watcher.js';
import { enableAutoMergeWith } from './lib/orchestration/single-story-close/phases/auto-merge.js';
import { sleep as defaultSleep } from './lib/util/poll-loop.js';

/** Framework fallbacks when neither a CLI flag nor config supplies a value. */
export const WATCH_DEFAULTS = Object.freeze({
  pollIntervalMs: 10_000,
  maxPolls: 180,
  maxUpdates: 3,
  maxResumes: 3,
});

/** Exit code reserved for the slow-but-not-red `still-running` verdict. */
export const STILL_RUNNING_EXIT_CODE = 2;

/**
 * How long a first probe that resolved NO required contexts is retried before
 * it is reported as a failure (Story #4873).
 *
 * A repository ruleset attaches its required contexts to a pull request
 * asynchronously — tens of seconds after the PR opens, on a cold repo. The
 * watcher used to treat that first empty probe as a hard `gh-checks-failed`
 * and exit 1, so a watch launched immediately after `gh pr create` failed a
 * delivery whose CI had not even been asked to start yet. "Not attached yet"
 * and "this repo has no required checks" are indistinguishable in one probe;
 * they are distinguishable across a bounded window, so the window is what we
 * spend before believing the first answer.
 */
export const REQUIRED_CONTEXT_ATTACH_WINDOW_MS = 90_000;

/**
 * Merge-state values that reconcile an observed all-green required set with
 * the repository's own view of the pull request (Story #4873).
 *
 * `BLOCKED` is the measured false-green: the watcher's `gh pr checks
 * --required` set came back SMALLER than branch protection's — a context
 * attached after the first probe, so it was never in `requiredChecks` — every
 * check the watcher knew about was green, and it reported green while GitHub
 * still refused the merge. `UNKNOWN` / an unreadable probe is not a
 * reconciliation either: it is the absence of the second opinion, and a green
 * verdict is exactly the verdict that must not be issued on absent evidence.
 */
const RECONCILED_MERGE_STATES = Object.freeze(
  new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS', 'BEHIND', 'DRAFT']),
);

/**
 * Does an observed-green required set reconcile with the repository's own
 * verdict on the PR? Pure — exported so the rule is reviewable as code.
 *
 * @param {{ observedRequired?: string[], mergeStateStatus?: string|null }} args
 * @returns {{ reconciled: boolean, mergeStateStatus: string|null, reason: string }}
 */
export function reconcileGreenVerdict({
  observedRequired = [],
  mergeStateStatus,
} = {}) {
  const state = String(mergeStateStatus ?? '')
    .trim()
    .toUpperCase();
  const observed = observedRequired.length;
  if (!state) {
    return {
      reconciled: false,
      mergeStateStatus: null,
      reason:
        `observed ${observed} required check(s) green, but the repository's merge state ` +
        'could not be read — the observed set cannot be reconciled, so the green verdict is withheld',
    };
  }
  if (RECONCILED_MERGE_STATES.has(state)) {
    return {
      reconciled: true,
      mergeStateStatus: state,
      reason: `observed ${observed} required check(s) green and the repository reports mergeStateStatus=${state}`,
    };
  }
  return {
    reconciled: false,
    mergeStateStatus: state,
    reason:
      `observed ${observed} required check(s) green, but the repository reports ` +
      `mergeStateStatus=${state} — branch protection is enforcing a context this watch did not observe`,
  };
}

/** Default merge-state probe: one `gh pr view --json mergeStateStatus`. */
async function defaultMergeStateProbe({ prRef }) {
  try {
    const view = await defaultGh.pr.view(prRef, ['mergeStateStatus']);
    return typeof view?.mergeStateStatus === 'string'
      ? view.mergeStateStatus
      : null;
  } catch {
    return null;
  }
}

/**
 * Adapt the watch loop's own `ghPrViewFn` port — which already spawns
 * `gh pr view --json mergeStateStatus` for BEHIND recovery — into the
 * reconciliation probe, so a caller that injected one port does not have to
 * inject a second for the same `gh` call.
 */
function mergeStateProbeFromView(ghPrViewFn) {
  return async ({ prRef, cwd }) => {
    try {
      const view = await ghPrViewFn({ prUrl: prRef, cwd });
      if (view?.status !== 0) return null;
      const parsed = JSON.parse(String(view.stdout ?? '').trim());
      return typeof parsed?.mergeStateStatus === 'string'
        ? parsed.mergeStateStatus
        : null;
    } catch {
      return null;
    }
  };
}

/**
 * Run the watch, retrying a first probe that could not resolve any required
 * context until {@link REQUIRED_CONTEXT_ATTACH_WINDOW_MS} elapses (Story
 * #4873 AC-3). Every other terminal — green, red, still-running — returns on
 * the first arm exactly as before.
 */
async function watchWithAttachWindow({
  watchArgs,
  attachWindowMs,
  retryIntervalMs,
  sleepFn,
  nowMsFn,
  logger,
}) {
  const deadline = nowMsFn() + attachWindowMs;
  // The window is wall-clock, but the retry count is also capped: a caller
  // running with a zero poll interval (every unit test, and a config that
  // sets one) would otherwise spin the window out as a tight loop. Flooring
  // the assumed cadence at 5s bounds the attempts without changing the
  // wall-clock bound that governs a real watch.
  const maxRetries = Math.ceil(attachWindowMs / Math.max(retryIntervalMs, 5000));
  let result = await watchPrToTerminal(watchArgs);
  let retries = 0;
  while (result.error && retries < maxRetries && nowMsFn() < deadline) {
    retries += 1;
    logger?.warn?.(
      `[pr-watch] no required contexts resolved yet (${result.error}) — a ruleset can attach them ` +
        `tens of seconds after a PR opens; retrying within the ${Math.round(attachWindowMs / 1000)}s ` +
        `attach window (attempt ${retries}).`,
    );
    await sleepFn(retryIntervalMs);
    result = await watchPrToTerminal(watchArgs);
  }
  return { ...result, attachRetries: retries };
}

function parsePositiveInt(raw, fallback) {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Resolve the effective poll knobs: CLI flag → `delivery.ci.watch.*` →
 * framework fallback. Pure (given a config bag) — exported for tests so
 * the precedence ladder is reviewable. `flags` are the raw string values
 * from `parseArgs` (or numbers, in tests); a nullish flag falls through
 * to config, and a nullish config field falls through to the default.
 *
 * @param {object} opts
 * @param {object|null} [opts.config]  resolved config (or a bare bag).
 * @param {object} [opts.flags]        `{ pollIntervalMs, maxPolls, maxResumes, maxUpdates }`.
 * @returns {{ pollIntervalMs: number, maxPolls: number, maxResumes: number, maxUpdates: number }}
 */
export function resolveWatchKnobs({ config, flags = {} } = {}) {
  const watch = getCiDelivery(config).watch ?? {};
  const pick = (flag, cfg, dflt) =>
    parsePositiveInt(flag, Number.isInteger(cfg) && cfg >= 0 ? cfg : dflt);
  return {
    pollIntervalMs: pick(
      flags.pollIntervalMs,
      watch.pollIntervalMs,
      WATCH_DEFAULTS.pollIntervalMs,
    ),
    maxPolls: pick(flags.maxPolls, watch.maxPolls, WATCH_DEFAULTS.maxPolls),
    maxResumes: pick(
      flags.maxResumes,
      watch.maxResumes,
      WATCH_DEFAULTS.maxResumes,
    ),
    maxUpdates: pick(flags.maxUpdates, undefined, WATCH_DEFAULTS.maxUpdates),
  };
}

/** Default re-arm: the sanctioned auto-merge enablement path. */
function defaultReArm({ cwd, prNumber }) {
  return enableAutoMergeWith({ cwd, prNumber });
}

/**
 * Red path (Story #4865). Disarm native auto-merge FIRST — that is the
 * race-free moment, before any green can exist — then record the digest so
 * the green path can adjudicate against the head SHA the red happened on.
 *
 * A disarm failure is a **blocker**, not a warning: an armed PR whose
 * required check went red can still be merged by GitHub the instant a
 * re-run turns it green, which is precisely what this guard exists to stop.
 *
 * @returns {Promise<{ headSha: string|null, disarm: object, digestPaths: object|null, blocked: boolean }>}
 */
async function handleRedWatch({
  storyId,
  prNumber,
  prRef,
  failures,
  tempRoot,
  cwd,
  writeDigestFn,
  headShaFn,
  disarmFn,
  blockFn,
  logger,
}) {
  const disarm = disarmFn({ prRef, cwd });
  const scope = resolveDigestScope({ storyId });
  const headSha = scope ? headShaFn({ prRef, cwd }) : null;
  let digestPaths = null;
  try {
    digestPaths = writeDigestFn({
      storyId,
      prNumber,
      headSha,
      failures,
      tempRoot,
      cwd,
      prRef,
    });
  } catch (err) {
    logger.warn?.(
      `[pr-watch] failed to write CI digest (non-fatal): ${err?.message ?? err}`,
    );
  }
  let blocked = false;
  if (!disarm.disarmed) {
    logger.error?.(
      `[pr-watch] BLOCKER: auto-merge could NOT be disarmed on PR #${prNumber} (${disarm.detail}). ` +
        'An armed PR can merge the moment a re-run turns it green — the no-rerun rule cannot be enforced.',
    );
    const outcome = await blockFn({
      storyId,
      body: [
        '### Auto-merge could not be disarmed after a red check — delivery blocked',
        '',
        `A required check went red on PR #${prNumber}, but disarming native auto-merge failed:`,
        '',
        `> ${disarm.detail}`,
        '',
        'While the PR stays armed, GitHub can merge it server-side the instant the',
        'checks read green — including a green reached by re-running the failed job,',
        'which `.agents/rules/ci-remediation.md` § Verifier forbids. Disarm the PR by',
        'hand (or fix the `gh` fault), then resume the delivery.',
      ].join('\n'),
    });
    blocked = Boolean(outcome?.blocked);
  } else {
    logger.error?.(
      `[pr-watch] native auto-merge ${disarm.alreadyUnarmed ? 'was already un-armed' : 'DISARMED'} on PR #${prNumber} — ` +
        'it is re-armed only by a green on a NEW head SHA.',
    );
  }
  if (digestPaths) {
    logger.error?.(`[pr-watch] CI failure digest → ${digestPaths.jsonPath}`);
  }
  return { headSha, disarm, digestPaths, blocked };
}

/**
 * Green path (Story #4865). Adjudicate the green against any digest the
 * scope recorded, and return the exit code with the report the caller
 * prints.
 *
 * @returns {Promise<{ verdict: string, reason: string, exitCode: number, headSha: string|null, reArmed?: boolean, blocked?: boolean }>}
 */
async function evaluateGreenWatch({
  storyId,
  prNumber,
  prRef,
  tempRoot,
  cwd,
  readDigestFn,
  retireDigestFn,
  headShaFn,
  reArmFn,
  blockFn,
  logger,
}) {
  const scope = resolveDigestScope({ storyId });
  if (!scope) {
    return {
      verdict: 'clean',
      reason: 'no --story scope: no digest can be keyed, guard inert',
      exitCode: 0,
      headSha: null,
    };
  }
  const digest = readDigestFn({ storyId, tempRoot, cwd });
  if (!digest) {
    return {
      verdict: 'clean',
      reason: 'no digest for this scope: this delivery never went red',
      exitCode: 0,
      headSha: null,
    };
  }
  const headSha = headShaFn({ prRef, cwd });
  const { verdict, reason } = classifyGreenVerdict({ digest, headSha });
  if (verdict === 'fix-at-source') {
    retireDigestFn({ storyId, tempRoot, cwd });
    const reArm = await reArmFn({ cwd, prNumber });
    const reArmed = Boolean(reArm?.enabled);
    logger.info?.(
      `[pr-watch] green on a NEW head SHA (${reason}) — fix at source; digest retired, ` +
        `auto-merge ${reArmed ? 're-armed' : `NOT re-armed (${reArm?.reason ?? 'unknown'})`}.`,
    );
    return { verdict, reason, exitCode: 0, headSha, reArmed };
  }
  const body = formatRerunViolation({ digest, headSha, prNumber, reason });
  logger.error?.(
    `[pr-watch] FORBIDDEN CI RE-RUN: ${reason}. Required check \`${digest.failingCheck}\` was red on this exact commit.`,
  );
  logger.error?.(
    `[pr-watch] run link: ${digest.runUrl ?? `run id ${digest.runId ?? 'unresolved'}`} — classification: ${digest.classification ?? 'unknown'}`,
  );
  logger.error?.(
    '[pr-watch] fix the root cause and push a new commit, or file a `meta::framework-gap` issue carrying the run link and failure signature.',
  );
  const outcome = await blockFn({ storyId, body });
  return {
    verdict,
    reason,
    exitCode: 1,
    headSha,
    blocked: Boolean(outcome?.blocked),
  };
}

/**
 * Run the watch loop and resolve to the exit code. Exported for tests so
 * the green / red / still-running / BEHIND paths can be exercised with
 * injected `gh` spawns and no `process.exit`.
 *
 *   0 → all required checks green (and the no-rerun guard cleared them).
 *   1 → a required check genuinely failed (red), OR the green was reached
 *       by a forbidden re-run of the same commit.
 *   2 → still-running (slow CI): cap + resume budget exhausted, none red.
 *
 * @param {object} opts
 * @param {number} opts.prNumber
 * @param {string|null} [opts.repo]
 * @param {number|string} [opts.maxUpdates]
 * @param {number|string} [opts.pollIntervalMs]
 * @param {number|string} [opts.maxPolls]
 * @param {number|string} [opts.maxResumes]
 * @param {object|null} [opts.config]         resolved config (defaults to resolveConfig()).
 * @param {string} [opts.tempRoot]            digest output dir (default `temp`).
 * @param {Function} [opts.ghPrChecksFn]      inject for tests
 * @param {Function} [opts.ghPrViewFn]        inject for tests
 * @param {Function} [opts.ghPrUpdateBranchFn] inject for tests
 * @param {Function} [opts.sleepFn]           inject for tests
 * @param {Function} [opts.writeDigestFn]     inject for tests (default writeCiDigest)
 * @param {Function} [opts.readDigestFn]      inject for tests (default readCiDigest)
 * @param {Function} [opts.retireDigestFn]    inject for tests (default retireCiDigest)
 * @param {Function} [opts.headShaFn]         inject for tests (default resolvePrHeadSha)
 * @param {Function} [opts.disarmAutoMergeFn] inject for tests (default disarmAutoMerge)
 * @param {Function} [opts.reArmAutoMergeFn]  inject for tests (default enableAutoMergeWith)
 * @param {Function} [opts.blockDeliveryFn]   inject for tests (default blockStoryDelivery)
 * @param {object} [opts.logger]
 * @param {(line: string) => void} [opts.print] stdout sink (default process.stdout)
 * @returns {Promise<number>} process exit code.
 */
export async function runPrWatch({
  prNumber,
  repo = null,
  storyId = null,
  maxUpdates,
  pollIntervalMs,
  maxPolls,
  maxResumes,
  config,
  tempRoot,
  ghPrChecksFn,
  ghPrViewFn,
  ghPrUpdateBranchFn,
  sleepFn,
  writeDigestFn = writeCiDigest,
  readDigestFn = readCiDigest,
  retireDigestFn = retireCiDigest,
  headShaFn = resolvePrHeadSha,
  disarmAutoMergeFn = disarmAutoMerge,
  reArmAutoMergeFn = defaultReArm,
  blockDeliveryFn = blockStoryDelivery,
  mergeStateProbeFn,
  attachWindowMs = REQUIRED_CONTEXT_ATTACH_WINDOW_MS,
  nowMsFn = Date.now,
  logger = Logger,
  print = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  if (!Number.isInteger(prNumber) || prNumber < 1)
    throw new TypeError('runPrWatch: --pr requires a positive integer');

  const resolvedConfig =
    config !== undefined ? config : safeResolveConfig(logger);
  const knobs = resolveWatchKnobs({
    config: resolvedConfig,
    flags: { pollIntervalMs, maxPolls, maxResumes, maxUpdates },
  });
  const effectiveTempRoot =
    tempRoot ?? resolvedConfig?.project?.paths?.tempRoot ?? 'temp';
  const cwd = process.cwd();

  // `gh` accepts a bare PR number or a URL; passing `<repo>#<n>` lets
  // `gh` resolve the right repository without a URL. When `--repo` is
  // omitted, `gh` infers the repo from the cwd's remote.
  const prRef = repo ? `${repo}#${prNumber}` : String(prNumber);

  const result = await watchWithAttachWindow({
    watchArgs: {
      prUrl: prRef,
      cwd,
      maxPolls: knobs.maxPolls,
      maxUpdates: knobs.maxUpdates,
      maxResumes: knobs.maxResumes,
      pollIntervalMs: knobs.pollIntervalMs,
      ...(ghPrChecksFn ? { ghPrChecksFn } : {}),
      ...(ghPrViewFn ? { ghPrViewFn } : {}),
      ...(ghPrUpdateBranchFn ? { ghPrUpdateBranchFn } : {}),
      ...(sleepFn ? { sleepFn } : {}),
      logger,
    },
    attachWindowMs,
    retryIntervalMs: knobs.pollIntervalMs,
    sleepFn: sleepFn ?? defaultSleep,
    nowMsFn,
    logger,
  });

  // Always print the final outcomes map so the operator (and the
  // workflow log) can see exactly which check blocked.
  const envelope = {
    prNumber,
    checkOutcomes: result.outcomes,
    requiredChecks: result.requiredChecks,
    polls: result.polls,
    updatesApplied: result.updatesApplied,
    resumesApplied: result.resumesApplied,
    terminal: result.terminal,
    green: result.green,
    stillRunning: result.stillRunning,
    ...(result.attachRetries ? { attachRetries: result.attachRetries } : {}),
    ...(result.error ? { error: result.error } : {}),
  };

  if (result.error) {
    print(JSON.stringify(envelope));
    logger.error?.(
      `[pr-watch] could not resolve required checks: ${result.error}`,
    );
    return 1;
  }

  if (result.green) {
    // Never green on an undercount (Story #4873). The observed required set is
    // whatever `gh pr checks --required` returned on the FIRST probe; when a
    // ruleset attached a context after that, every check we knew about can be
    // green while GitHub still refuses the merge. Reconcile against the
    // repository's own verdict before any green is issued — an unreconcilable
    // set reports unresolved (exit 2, keep watching) rather than a false green
    // or a false red.
    const probeMergeState =
      mergeStateProbeFn ??
      (ghPrViewFn
        ? mergeStateProbeFromView(ghPrViewFn)
        : defaultMergeStateProbe);
    const reconciliation = reconcileGreenVerdict({
      observedRequired: result.requiredChecks,
      mergeStateStatus: await probeMergeState({ prRef, cwd, prNumber }),
    });
    if (!reconciliation.reconciled) {
      print(JSON.stringify({ ...envelope, reconciliation }));
      logger.warn?.(
        `[pr-watch] withholding the green verdict: ${reconciliation.reason}. ` +
          'Re-run the watch once the repository settles, or inspect branch protection for a context this watch never saw.',
      );
      return STILL_RUNNING_EXIT_CODE;
    }
    const guard = await evaluateGreenWatch({
      storyId,
      prNumber,
      prRef,
      tempRoot: effectiveTempRoot,
      cwd,
      readDigestFn,
      retireDigestFn,
      headShaFn,
      reArmFn: reArmAutoMergeFn,
      blockFn: blockDeliveryFn,
      logger,
    });
    print(JSON.stringify({ ...envelope, reconciliation, rerunGuard: guard }));
    if (guard.exitCode === 0) {
      logger.info?.('[pr-watch] all required checks green.');
    }
    return guard.exitCode;
  }

  // Slow-but-not-red: the cap AND resume budget are exhausted with checks
  // still pending and none failed. Never exit 1, never `timed_out` — hand
  // off to the host's interval loop and exit 2.
  if (result.stillRunning) {
    print(JSON.stringify(envelope));
    const stillPending = Object.entries(result.outcomes)
      .filter(([, v]) => v === 'still-running')
      .map(([k]) => k)
      .join(', ');
    logger.warn?.(
      `[pr-watch] required check(s) still running after ${result.polls} polls + ${result.resumesApplied} resumes: ${stillPending}. Keep polling natively:`,
    );
    logger.warn?.('[pr-watch]   gh pr checks <pr> --watch');
    return STILL_RUNNING_EXIT_CODE;
  }

  // Genuine red check — exit 1 immediately, disarm auto-merge, write the
  // digest, and surface the fix-loop handoff.
  // Exclude 'still-running' as well as the non-failing states: when the cap
  // fires with a mixed failed+pending map, promotePendingToStillRunning has
  // rewritten the pending entries, and a still-running check is slow, not
  // red — including it here would let it become the digest's "primary"
  // failing check and mispoint the diagnosis at a slow check.
  const failures = Object.entries(result.outcomes)
    .filter(
      ([, v]) =>
        v !== 'success' &&
        v !== 'neutral' &&
        v !== 'skipped' &&
        v !== 'still-running',
    )
    .map(([name, outcome]) => ({ name, outcome }));
  const red = failures.map((f) => `${f.name}=${f.outcome}`).join(', ');
  logger.error?.(`[pr-watch] required check(s) not green: ${red}`);
  const redOutcome = await handleRedWatch({
    storyId,
    prNumber,
    prRef,
    failures,
    tempRoot: effectiveTempRoot,
    cwd,
    writeDigestFn,
    headShaFn,
    disarmFn: disarmAutoMergeFn,
    blockFn: blockDeliveryFn,
    logger,
  });
  print(
    JSON.stringify({
      ...envelope,
      classification: classifyFailure(failures[0]?.name),
      rerunGuard: {
        verdict: 'red',
        headSha: redOutcome.headSha,
        autoMergeDisarmed: redOutcome.disarm.disarmed,
        disarmDetail: redOutcome.disarm.detail,
        digestPath: redOutcome.digestPaths?.jsonPath ?? null,
        blocked: redOutcome.blocked,
      },
    }),
  );
  logger.error?.(
    '[pr-watch] a required check failed. Read the digest, reproduce the failure, and apply the smallest fix at source, ' +
      'then push a new commit — re-running the failed job is forbidden (`.agents/rules/ci-remediation.md` § Verifier).',
  );
  return 1;
}

/** Resolve config without letting a config error abort the watch. */
function safeResolveConfig(logger) {
  try {
    return resolveConfig();
  } catch (err) {
    logger?.warn?.(
      `[pr-watch] config resolve failed; using framework watch defaults: ${err?.message ?? err}`,
    );
    return null;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      pr: { type: 'string' },
      repo: { type: 'string' },
      story: { type: 'string' },
      'max-updates': { type: 'string' },
      'poll-interval-ms': { type: 'string' },
      'max-polls': { type: 'string' },
      'max-resumes': { type: 'string' },
    },
    strict: false,
  });
  return runPrWatch({
    prNumber: Number.parseInt(values.pr ?? '', 10),
    repo: values.repo ?? null,
    storyId: values.story ?? null,
    maxUpdates: values['max-updates'],
    pollIntervalMs: values['poll-interval-ms'],
    maxPolls: values['max-polls'],
    maxResumes: values['max-resumes'],
  });
}

runAsCli(import.meta.url, main, {
  source: 'pr-watch-with-update',
  propagateExitCode: true,
});
