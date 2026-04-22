#!/usr/bin/env node

/**
 * .agents/scripts/check-branch-protection.js — Branch-Protection Prerequisite Gate
 *
 * When `/sprint-close` is about to merge an `epic::auto-close` Epic into
 * `main`, the merge target MUST be protected. Without protection, an
 * automated merge races against a human direct-push (no review, no CI) and
 * publishes whichever commit landed last. This gate refuses the merge if
 * `/repos/{owner}/{repo}/branches/{base}/protection` returns no rule.
 *
 * The check is a no-op when the Epic does not carry `epic::auto-close` —
 * operator-supervised merges fall back to GitHub's normal review flow, and
 * this gate would add noise rather than safety.
 *
 * Usage:
 *   node .agents/scripts/check-branch-protection.js --epic <ID> [--base main] [--force]
 *
 * Exit codes:
 *   0 — protection present, or Epic does not carry epic::auto-close.
 *   1 — epic::auto-close is set and the base branch is unprotected.
 *   2 — configuration error (missing epic id, provider rejected request).
 */

import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { EPIC_LABELS } from './lib/label-constants.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

export async function runBranchProtectionCheck({
  epicId,
  base = 'main',
  force = false,
  injectedProvider,
} = {}) {
  if (!epicId || Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal(
      'Usage: node check-branch-protection.js --epic <EPIC_ID> [--base <branch>] [--force]',
    );
  }

  const { orchestration } = resolveConfig();
  const provider = injectedProvider || createProvider(orchestration);

  let epic;
  try {
    epic = await provider.getEpic(epicId);
  } catch (err) {
    console.error(
      `[branch-protection] Could not fetch Epic #${epicId}: ${err.message}`,
    );
    process.exit(2);
  }

  const labels = epic.labels ?? [];
  const autoClose = labels.includes(EPIC_LABELS.AUTO_CLOSE);
  if (!autoClose && !force) {
    console.log(
      `[branch-protection] ⏭  Epic #${epicId} does not carry '${EPIC_LABELS.AUTO_CLOSE}'; ` +
        `skipping protection check (operator-supervised merge).`,
    );
    return { required: false, enabled: null, skipped: true };
  }

  if (typeof provider.getBranchProtection !== 'function') {
    console.error(
      `[branch-protection] Provider does not implement getBranchProtection(); ` +
        `cannot verify protection on '${base}'. Refusing auto-merge.`,
    );
    process.exit(1);
  }

  let result;
  try {
    result = await provider.getBranchProtection(base);
  } catch (err) {
    console.error(
      `[branch-protection] Could not query protection for '${base}': ${err.message}`,
    );
    process.exit(2);
  }

  if (!result?.enabled) {
    console.error(
      `[branch-protection] ❌ '${base}' is unprotected, but Epic #${epicId} ` +
        `carries '${EPIC_LABELS.AUTO_CLOSE}'. Auto-merge is refused.\n\n` +
        `Resolve by either:\n` +
        `  • Enabling branch protection on '${base}' (required review, ` +
        `status checks), then re-running /sprint-close; or\n` +
        `  • Removing '${EPIC_LABELS.AUTO_CLOSE}' from Epic #${epicId} and ` +
        `performing the merge under human review.`,
    );
    process.exit(1);
  }

  console.log(
    `[branch-protection] ✅ '${base}' is protected; Epic #${epicId} auto-merge is cleared.`,
  );
  return { required: true, enabled: true };
}

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      base: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
    strict: false,
  });
  const epicId = Number.parseInt(values.epic ?? '', 10);
  await runBranchProtectionCheck({
    epicId,
    base: values.base ?? 'main',
    force: values.force === true,
  });
}

runAsCli(import.meta.url, main, { source: 'check-branch-protection' });
