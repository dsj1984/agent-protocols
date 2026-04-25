#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * pool-claim.js — `/sprint-execute` pool-mode entry point.
 *
 * Invoked when the slash command runs without a story id. Picks the next
 * eligible story from the Epic's dispatch manifest, claims it via the
 * `in-progress-by:<sessionId>` label + `[claim]` comment protocol from
 * `lib/pool-mode.js`, and prints the resulting story id as JSON for the
 * caller to feed into `sprint-story-init.js --story <id>`.
 *
 * Usage:
 *   node .agents/scripts/pool-claim.js [--epic <id>] [--max-attempts <n>]
 *
 * When `--epic` is omitted, the script scans `temp/dispatch-manifest-*.json`
 * and uses the only manifest present; if zero or more than one are found the
 * call exits with a clear error rather than guessing.
 *
 * Output (always JSON, single line on stdout):
 *   { ok: true,  storyId, story, sessionId }
 *   { ok: false, reason, details? }
 *
 * Exit codes:
 *   0 — claim succeeded OR no eligible story (operator outcome, not error).
 *   1 — usage / config / network failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { runAsCli } from './lib/cli-utils.js';
import {
  PROJECT_ROOT,
  resolveConfig,
  resolveRuntime,
} from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import {
  claimStory,
  findEligibleStory,
  releaseStory,
} from './lib/pool-mode.js';
import { createProvider } from './lib/provider-factory.js';
import { loadDispatchManifest } from './lib/story-init/dependency-guard.js';

const DEFAULT_MAX_ATTEMPTS = 5;

function parseCliArgs(argv = process.argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      epic: { type: 'string' },
      'max-attempts': { type: 'string' },
      cwd: { type: 'string' },
    },
    strict: false,
  });
  const epicId = values.epic ? Number.parseInt(values.epic, 10) : null;
  const maxAttempts = values['max-attempts']
    ? Number.parseInt(values['max-attempts'], 10)
    : DEFAULT_MAX_ATTEMPTS;
  return {
    epicId: Number.isInteger(epicId) && epicId > 0 ? epicId : null,
    maxAttempts:
      Number.isInteger(maxAttempts) && maxAttempts > 0
        ? maxAttempts
        : DEFAULT_MAX_ATTEMPTS,
    cwd: values.cwd ? path.resolve(values.cwd) : PROJECT_ROOT,
  };
}

/**
 * Resolve the Epic id when the operator omitted `--epic`. Scans
 * `<cwd>/temp/dispatch-manifest-*.json`; succeeds only when exactly one
 * manifest is present so the script never guesses across epics.
 */
function inferEpicId(cwd) {
  const tempDir = path.join(cwd, 'temp');
  if (!fs.existsSync(tempDir)) return { ok: false, reason: 'no-temp-dir' };
  const matches = fs
    .readdirSync(tempDir)
    .map((name) => /^dispatch-manifest-(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  if (matches.length === 0) return { ok: false, reason: 'no-manifest-on-disk' };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'multiple-manifests-on-disk',
      epics: matches.sort((a, b) => a - b),
    };
  }
  return { ok: true, epicId: matches[0] };
}

function emit(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(exitCode);
}

export async function runPoolClaim(opts = {}) {
  const args = opts.args ?? parseCliArgs();
  const cwd = args.cwd ?? PROJECT_ROOT;

  let epicId = args.epicId;
  if (!epicId) {
    const inferred = inferEpicId(cwd);
    if (!inferred.ok) {
      return emit(
        {
          ok: false,
          reason: inferred.reason,
          details: inferred,
          hint: 'Pass --epic <id> or regenerate a single dispatch manifest via /sprint-plan.',
        },
        1,
      );
    }
    epicId = inferred.epicId;
  }

  const config = opts.injectedConfig ?? resolveConfig({ cwd });
  const { orchestration } = config;
  const provider = opts.injectedProvider ?? createProvider(orchestration);
  const runtime = resolveRuntime({ config });

  const repoSlug =
    orchestration?.github?.owner && orchestration?.github?.repo
      ? `${orchestration.github.owner}/${orchestration.github.repo}`
      : undefined;

  const load = await loadDispatchManifest({
    epicId,
    projectRoot: cwd,
    provider,
    repoSlug,
  });
  if (!load.ok) {
    return emit(
      {
        ok: false,
        reason: 'manifest-load-failed',
        details: { epicId, reason: load.reason },
        hint: 'Regenerate the dispatch manifest via /sprint-plan and retry.',
      },
      1,
    );
  }

  const ctx = { provider, runtime };
  const tried = [];

  for (let attempt = 1; attempt <= args.maxAttempts; attempt += 1) {
    const pick = await findEligibleStory(epicId, load.manifest, ctx);
    if (pick.reason === 'no-eligible') {
      return emit(
        {
          ok: false,
          reason: 'no-eligible',
          details: pick.details,
          tried,
          hint: 'Wave fully claimed or complete — no story available to claim.',
        },
        0,
      );
    }

    const claim = await claimStory(pick.storyId, runtime, ctx);
    if (claim.ok) {
      return emit({
        ok: true,
        storyId: pick.storyId,
        story: {
          storyId: pick.story.storyId,
          storyTitle: pick.story.storyTitle,
          earliestWave: pick.story.earliestWave,
          branchName: pick.story.branchName,
        },
        sessionId: runtime.sessionId,
        epicId,
        attempts: attempt,
      });
    }

    tried.push({
      storyId: pick.storyId,
      raceLostTo: claim.winnerSessionId,
    });
    await releaseStory(pick.storyId, runtime, ctx).catch((err) => {
      Logger.warn(
        `[pool-claim] release after race-loss on #${pick.storyId} failed: ${err.message}`,
      );
    });
  }

  return emit(
    {
      ok: false,
      reason: 'max-attempts-exhausted',
      tried,
      hint: 'All eligible stories were claimed by sibling sessions during the attempt window. Re-run shortly.',
    },
    0,
  );
}

runAsCli(import.meta.url, runPoolClaim, { source: 'pool-claim' });
