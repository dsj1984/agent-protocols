#!/usr/bin/env node

/**
 * .agents/scripts/sprint-close.js — Final Epic Lifecycle Closure
 *
 * The operator-facing `/sprint-close` workflow is structured around five
 * named phases (Validate → Review → Land → Finalize → Notify). This script
 * owns the Finalize and Notify phases end-to-end and exposes the earlier
 * phases as dedicated sister scripts (`sprint-wave-gate.js`,
 * `validate-docs-freshness.js`, `check-branch-protection.js`,
 * `sprint-code-review.js`) that the workflow invokes before the merge.
 *
 * Finalize:
 *   1. Close auxiliary tickets (PRD, Tech Spec, Sprint Health dashboard).
 *   2. Close the Epic issue with a notification comment.
 *   3. Reap stale worktrees and delete local + remote Epic/Story branches.
 *
 * Notify:
 *   4. Emit the terminal banner (success or warning summary) and honour
 *      `--skip-retro` / `--skip-code-review` by logging the override so
 *      the operator has an audit trail.
 *
 * The merge-to-main and version tag remain high-visibility manual steps
 * in the workflow; this script is deliberately agnostic about them so a
 * failed release never corrupts the Epic closure state.
 *
 * Usage:
 *   node .agents/scripts/sprint-close.js --epic <EPIC_ID>
 *     [--no-cleanup] [--skip-retro] [--skip-code-review]
 */

import { parseArgs } from 'node:util';

import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { gitSpawn } from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import {
  postStructuredComment,
  STATE_LABELS,
  transitionTicketState,
} from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';
import { WorktreeManager } from './lib/worktree-manager.js';

const progress = Logger.createProgress('sprint-close', { stderr: false });

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      cleanup: { type: 'boolean', default: true },
      'skip-retro': { type: 'boolean', default: false },
      'skip-code-review': { type: 'boolean', default: false },
    },
    strict: false,
  });

  const epicId = Number.parseInt(values.epic ?? '', 10);

  if (Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal('Usage: node sprint-close.js --epic <EPIC_ID>');
  }

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  progress('INIT', `Starting formal closure for Epic #${epicId}...`);

  logSkipOverrides({
    skipRetro: values['skip-retro'] === true,
    skipCodeReview: values['skip-code-review'] === true,
  });

  const warnings = [];

  // Finalize phase ----------------------------------------------------------
  await phaseFinalizeAuxiliaryTickets(provider, epicId, warnings);
  await phaseFinalizeEpicClosure(provider, epicId, warnings);
  if (values.cleanup) {
    await phaseFinalizeBranchCleanup(provider, orchestration, epicId, warnings);
  }

  // Notify phase ------------------------------------------------------------
  phaseNotifyBanner(epicId, warnings);
}

/**
 * Record `--skip-*` overrides so the audit trail shows why a pre-close gate
 * was bypassed. Logging is intentionally best-effort — a skip flag never
 * halts close, it only narrates what the operator chose.
 */
function logSkipOverrides({ skipRetro, skipCodeReview }) {
  if (skipCodeReview) {
    progress(
      'REVIEW',
      '⚠️ code review skipped by operator override (--skip-code-review)',
    );
  }
  if (skipRetro) {
    progress('NOTIFY', '⚠️ retro skipped by operator override (--skip-retro)');
  }
}

/**
 * Close `context::prd`, `context::tech-spec`, and `type::health` tickets
 * that belong to the Epic. Per-ticket failures are isolated so a misbehaving
 * auxiliary ticket never discards progress on its siblings.
 */
async function phaseFinalizeAuxiliaryTickets(provider, epicId, warnings) {
  try {
    progress(
      'CONTEXT',
      'Searching for PRD, Tech Spec, and Sprint Health tickets...',
    );
    const subTickets = await provider.getSubTickets(epicId);

    const auxiliaryTickets = subTickets.filter((t) => {
      if (
        t.labels.includes('context::prd') ||
        t.labels.includes('context::tech-spec')
      ) {
        return true;
      }
      if (t.labels.includes('type::health')) return true;
      if (
        typeof t.title === 'string' &&
        t.title.startsWith('📉 Sprint Health:')
      )
        return true;
      return false;
    });

    if (auxiliaryTickets.length === 0) {
      progress(
        'CONTEXT',
        'No open PRD / Tech Spec / Sprint Health tickets found.',
      );
      return;
    }

    await Promise.all(
      auxiliaryTickets.map(async (ticket) => {
        if (ticket.state === 'closed') return;

        const kind =
          ticket.labels.find((l) => l.startsWith('context::')) ??
          (ticket.labels.includes('type::health') ||
          (typeof ticket.title === 'string' &&
            ticket.title.startsWith('📉 Sprint Health:'))
            ? 'type::health'
            : 'auxiliary');

        progress('CONTEXT', `Closing ${kind} #${ticket.id}...`);
        try {
          await transitionTicketState(provider, ticket.id, STATE_LABELS.DONE);
          progress('CONTEXT', `✅ #${ticket.id} closed.`);
        } catch (err) {
          warnings.push(
            `auxiliary ticket #${ticket.id} (${kind}): ${err.message}`,
          );
          console.warn(
            `⚠️ Warning: Failed to close ${kind} #${ticket.id}: ${err.message}`,
          );
        }
      }),
    );
  } catch (err) {
    warnings.push(`auxiliary ticket enumeration: ${err.message}`);
    console.warn(
      `⚠️ Warning: Failed to fetch auxiliary tickets: ${err.message}`,
    );
  }
}

/**
 * Post the shipping notification comment on the Epic, then close it. An
 * Epic-close failure is recorded as a warning so downstream exit-code
 * handling can reflect partial success instead of silently announcing 🎉.
 */
async function phaseFinalizeEpicClosure(provider, epicId, warnings) {
  try {
    progress('EPIC', `Closing Epic #${epicId}...`);

    const epic = await provider.getTicket(epicId);
    if (epic.state !== 'closed') {
      await postStructuredComment(
        provider,
        epicId,
        'notification',
        `🎉 Epic #${epicId} has been successfully shipped. All tasks merged to main and context tickets closed.`,
      );

      await provider.updateTicket(epicId, {
        state: 'closed',
        state_reason: 'completed',
      });
      progress('EPIC', `✅ Epic #${epicId} closed.`);
    } else {
      progress('EPIC', `Epic #${epicId} is already closed.`);
    }
  } catch (err) {
    warnings.push(`epic #${epicId} close: ${err.message}`);
    console.error(`❌ Error: Failed to close Epic #${epicId}: ${err.message}`);
  }
}

/**
 * Reap stale worktrees and delete every local + remote branch owned by the
 * Epic. Batched git calls with per-ref fallback so individual failures
 * surface without aborting the whole pass.
 */
async function phaseFinalizeBranchCleanup(
  provider,
  orchestration,
  epicId,
  warnings,
) {
  progress('CLEANUP', 'Starting branch cleanup...');
  const wtConfig = orchestration?.worktreeIsolation;
  const wm = new WorktreeManager({
    repoRoot: PROJECT_ROOT,
    config: wtConfig,
    logger: {
      info: (m) => progress('WORKTREE', m),
      warn: (m) => progress('WORKTREE', `⚠️ ${m}`),
      error: (m) => console.error(`[sprint-close] ${m}`),
    },
  });

  // Reap worktrees — must happen before branch deletion. Worktree refs
  // hold implicit locks on their checked-out branches; `git branch -D`
  // fails with "checked out in worktree" if they aren't removed first.
  if (wtConfig?.enabled) {
    try {
      progress('CLEANUP', 'Reaping stale worktrees...');
      await wm.sweepStaleLocks();
      const epicBranchName = `epic/${epicId}`;
      const gcResult = await wm.gc([], { epicBranch: epicBranchName });
      if (gcResult.reaped.length > 0) {
        progress('CLEANUP', `Reaped ${gcResult.reaped.length} worktree(s).`);
      }
      if (gcResult.skipped.length > 0) {
        progress(
          'CLEANUP',
          `⚠️ ${gcResult.skipped.length} worktree(s) could not be reaped (dirty/unmerged):`,
        );
        for (const s of gcResult.skipped) {
          progress('CLEANUP', `   - story-${s.storyId}: ${s.reason}`);
        }
      }
    } catch (err) {
      console.warn(
        `⚠️ Warning: Worktree cleanup failed (non-fatal): ${err.message}`,
      );
    }
  }

  // Prune any worktree bookkeeping for directories that no longer exist on
  // disk. Even without worktreeIsolation enabled, stale entries in
  // `.git/worktrees/` can block branch deletion.
  progress('CLEANUP', 'Pruning stale worktree registrations...');
  const pruneResult = wm.prune();
  if (!pruneResult.pruned) {
    console.warn(
      `⚠️ Warning: git worktree prune failed (non-fatal): ${pruneResult.reason}`,
    );
  } else {
    progress('CLEANUP', '✅ Worktree registrations pruned.');
  }

  // Enumerate all branches to delete (epic + matching stories/tasks).
  const epicBranch = `epic/${epicId}`;
  const storyLegacyPattern = `story/epic-${epicId}/`;
  const taskLegacyPattern = `task/epic-${epicId}/`;

  let validTicketIds = new Set();
  try {
    const descendantIds = await collectEpicDescendantIds(provider, epicId);
    validTicketIds = new Set(descendantIds);
    progress(
      'CLEANUP',
      `Resolved ${validTicketIds.size} descendant ticket ID(s) for branch matching.`,
    );
  } catch (err) {
    warnings.push(`descendant enumeration: ${err.message}`);
    console.warn(
      `⚠️ Warning: Could not enumerate Epic descendants (${err.message}). ` +
        `story-<id> branch deletion will be skipped to avoid accidentally keeping live work. ` +
        `Legacy story/*, task/* patterns will still be matched.`,
    );
  }

  function matchesEpicBranch(branchName) {
    if (
      branchName.includes(storyLegacyPattern) ||
      branchName.includes(taskLegacyPattern)
    ) {
      return true;
    }
    const match = branchName.match(/^story-(\d+)$/);
    if (match && validTicketIds.has(Number.parseInt(match[1], 10))) {
      return true;
    }
    return false;
  }

  const remoteBranches = gitSpawn(PROJECT_ROOT, 'branch', '-r').stdout ?? '';
  const remoteToDelete = [
    epicBranch,
    ...remoteBranches
      .split('\n')
      .map((line) => line.trim().replace('origin/', ''))
      .filter((b) => b && matchesEpicBranch(b)),
  ];

  const localBranches = gitSpawn(PROJECT_ROOT, 'branch').stdout ?? '';
  const localToDelete = [
    epicBranch,
    ...localBranches
      .split('\n')
      .map((line) => line.trim().replace('* ', ''))
      .filter((b) => b && matchesEpicBranch(b)),
  ];

  if (remoteToDelete.length > 0) {
    progress(
      'CLEANUP',
      `Deleting ${remoteToDelete.length} remote branch(es): ${remoteToDelete.join(', ')}`,
    );
    const remoteResult = gitSpawn(
      PROJECT_ROOT,
      'push',
      'origin',
      '--delete',
      ...remoteToDelete,
    );
    if (remoteResult.status !== 0) {
      console.warn(
        `⚠️ Warning: Batched remote delete failed (${remoteResult.stderr}). Falling back to per-branch deletion...`,
      );
      for (const b of remoteToDelete) {
        const r = gitSpawn(PROJECT_ROOT, 'push', 'origin', '--delete', b);
        if (r.status !== 0) {
          warnings.push(`remote branch ${b}: ${r.stderr}`);
          console.warn(
            `⚠️ Warning: Could not delete remote branch ${b} (may not exist): ${r.stderr}`,
          );
        }
      }
    }
  }

  if (localToDelete.length > 0) {
    progress(
      'CLEANUP',
      `Deleting ${localToDelete.length} local branch(es): ${localToDelete.join(', ')}`,
    );
    const localResult = gitSpawn(
      PROJECT_ROOT,
      'branch',
      '-D',
      ...localToDelete,
    );
    if (localResult.status !== 0) {
      console.warn(
        `⚠️ Warning: Batched local delete failed (${localResult.stderr}). Falling back to per-branch deletion...`,
      );
      for (const b of localToDelete) {
        const r = gitSpawn(PROJECT_ROOT, 'branch', '-D', b);
        if (r.status !== 0) {
          warnings.push(`local branch ${b}: ${r.stderr}`);
          console.warn(
            `⚠️ Warning: Could not delete local branch ${b}: ${r.stderr}`,
          );
        }
      }
    }
  }

  if (remoteToDelete.length > 0 || localToDelete.length > 0) {
    gitSpawn(PROJECT_ROOT, 'remote', 'prune', 'origin');
  }
  progress('CLEANUP', '✅ Branch cleanup complete.');
}

function phaseNotifyBanner(epicId, warnings) {
  if (warnings.length === 0) {
    progress('DONE', `🎉 Formal closure for Epic #${epicId} finished.`);
    return;
  }
  progress(
    'DONE',
    `⚠️ Formal closure for Epic #${epicId} finished with ${warnings.length} warning(s):`,
  );
  for (const w of warnings) progress('DONE', `   - ${w}`);
  process.exitCode = 2;
}

/**
 * Recursively collect every descendant ticket ID under an Epic. Walks the
 * native sub-issue graph via `provider.getSubTickets` so Stories and Tasks
 * are captured even when their bodies only reference their immediate parent
 * (Feature or Story), not the Epic directly. Breadth-first with a visited
 * set so shared-ancestor cycles do not loop forever.
 *
 * @param {object} provider
 * @param {number} epicId
 * @returns {Promise<number[]>}
 */
async function collectEpicDescendantIds(provider, epicId) {
  const visited = new Set();
  const queue = [epicId];
  const out = [];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    const children = await provider.getSubTickets(parentId);
    for (const child of children) {
      if (!visited.has(child.id)) {
        out.push(child.id);
        queue.push(child.id);
      }
    }
  }
  return out;
}

main().catch((err) => {
  Logger.fatal(`sprint-close: ${err.message}`);
});
