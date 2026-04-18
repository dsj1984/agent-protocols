#!/usr/bin/env node

/**
 * .agents/scripts/sprint-close.js — Final Epic Lifecycle Closure
 *
 * Automates the terminal steps of an Epic lifecycle (Step 8, 9, and 11 of
 * sprint-close.md). This script handles:
 *
 *   1. Automatic discovery and closure of Context tickets (PRD, Tech Spec).
 *   2. Formal closure of the Epic issue with a summary comment.
 *   3. Cleanup of local and remote Task/Story branches.
 *
 * Usage:
 *   node .agents/scripts/sprint-close.js --epic <EPIC_ID>
 *
 * This script does NOT handle the merge to main or version tagging, which
 * remain as high-visibility manual/shell steps in the workflow to ensure
 * operator oversight for production releases.
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

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      cleanup: { type: 'boolean', default: true },
    },
    strict: false,
  });

  const epicId = parseInt(values.epic ?? '', 10);

  if (Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal('Usage: node sprint-close.js --epic <EPIC_ID>');
  }

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  progress('INIT', `Starting formal closure for Epic #${epicId}...`);

  // -------------------------------------------------------------------------
  // 1. Resolve and Close Context + Health Tickets (PRD, Tech Spec, Sprint Health)
  // -------------------------------------------------------------------------
  //
  // The Sprint Health ticket (`type::health`, title starts with "📉 Sprint
  // Health:") is a live-updated tracker dashboard created by the dispatcher.
  // Like PRD/Tech-Spec tickets it holds no planned work, so it is closed
  // alongside them here — otherwise it lingers as an orphan child of a
  // closed Epic and pollutes future project views.
  // Track warnings so the final status line can reflect partial success
  // instead of printing 🎉 when cleanup silently failed.
  const warnings = [];

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
    } else {
      // Isolate per-ticket failures so one misbehaving auxiliary ticket
      // does not discard progress on its siblings. Previously the whole
      // Promise.all rejected and the outer catch reported a single
      // generic warning without identifying which ticket failed.
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
    }
  } catch (err) {
    warnings.push(`auxiliary ticket enumeration: ${err.message}`);
    console.warn(
      `⚠️ Warning: Failed to fetch auxiliary tickets: ${err.message}`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Formal Epic Closure
  // -------------------------------------------------------------------------
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
    // Epic-close failure must be surfaced at the top-level exit status.
    // Previously this only logged to stderr, letting the script finish with
    // the 🎉 success banner whenever subsequent cleanup happened to succeed —
    // a dangerous signal for release operations where operators rely on
    // exit code to gate downstream steps.
    warnings.push(`epic #${epicId} close: ${err.message}`);
    console.error(`❌ Error: Failed to close Epic #${epicId}: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // 3. Branch Cleanup
  // -------------------------------------------------------------------------
  if (values.cleanup) {
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

    // 3.0a Reap worktrees — must happen before branch deletion. Worktree refs
    // hold implicit locks on their checked-out branches; `git branch -D`
    // fails with "checked out in worktree" if they aren't removed first.
    if (wtConfig?.enabled) {
      try {
        progress('CLEANUP', 'Reaping stale worktrees...');
        await wm.sweepStaleLocks();

        // Empty openStoryIds — the Epic is closing, all stories are done.
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

    // 3.0b Prune any worktree bookkeeping for directories that no longer
    // exist on disk. Even without worktreeIsolation enabled, stale entries
    // in `.git/worktrees/` can block branch deletion.
    progress('CLEANUP', 'Pruning stale worktree registrations...');
    const pruneResult = wm.prune();
    if (!pruneResult.pruned) {
      console.warn(
        `⚠️ Warning: git worktree prune failed (non-fatal): ${pruneResult.reason}`,
      );
    } else {
      progress('CLEANUP', '✅ Worktree registrations pruned.');
    }

    // 3.1 Enumerate all branches to delete (epic + matching stories/tasks)
    const epicBranch = `epic/${epicId}`;
    const storyLegacyPattern = `story/epic-${epicId}/`;
    const taskLegacyPattern = `task/epic-${epicId}/`;

    // Gather the full Epic descendant set (Features → Stories → Tasks) so
    // `story-<id>` branches are matched regardless of which body-regex
    // `getTickets` happens to index. Relying on `getTickets(epicId)` alone
    // missed Stories whose body referenced their Feature parent but not the
    // Epic directly, leaving branches stranded after a successful close.
    // Distinguish "fetch failed" from "no tickets" — the former is a real
    // warning the operator must see; the latter is a no-op.
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
      if (match && validTicketIds.has(parseInt(match[1], 10))) {
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

    // 3.2 Batch-delete remote branches in a single push (one TLS round-trip).
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
        // Batch failed — fall back to per-branch deletion to surface specific
        // failures (e.g., one branch already deleted on remote).
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

    // 3.3 Batch-delete local branches in a single git branch -D invocation.
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
        // Batch failed — fall back so individual failures (e.g., currently
        // checked-out branch) surface clearly.
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

    // 3.4 Prune stale tracking refs only when something was actually deleted.
    // `git remote prune origin` is faster than `git fetch --prune` because
    // it only refreshes the remote ref list rather than fetching objects.
    if (remoteToDelete.length > 0 || localToDelete.length > 0) {
      gitSpawn(PROJECT_ROOT, 'remote', 'prune', 'origin');
    }
    progress('CLEANUP', '✅ Branch cleanup complete.');
  }

  if (warnings.length === 0) {
    progress('DONE', `🎉 Formal closure for Epic #${epicId} finished.`);
  } else {
    progress(
      'DONE',
      `⚠️ Formal closure for Epic #${epicId} finished with ${warnings.length} warning(s):`,
    );
    for (const w of warnings) progress('DONE', `   - ${w}`);
    process.exitCode = 2;
  }
}

const progress = Logger.createProgress('sprint-close', { stderr: false });

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
