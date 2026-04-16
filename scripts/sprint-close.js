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
          await transitionTicketState(provider, ticket.id, STATE_LABELS.DONE);
          progress('CONTEXT', `✅ #${ticket.id} closed.`);
        }),
      );
    }
  } catch (err) {
    console.warn(
      `⚠️ Warning: Failed to process auxiliary tickets: ${err.message}`,
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
    console.error(`❌ Error: Failed to close Epic #${epicId}: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // 3. Branch Cleanup
  // -------------------------------------------------------------------------
  if (values.cleanup) {
    progress('CLEANUP', 'Starting branch cleanup...');

    // 3.0a Reap worktrees — must happen before branch deletion. Worktree refs
    // hold implicit locks on their checked-out branches; `git branch -D`
    // fails with "checked out in worktree" if they aren't removed first.
    const wtConfig = orchestration?.worktreeIsolation;
    if (wtConfig?.enabled) {
      try {
        progress('CLEANUP', 'Reaping stale worktrees...');
        const wm = new WorktreeManager({
          repoRoot: PROJECT_ROOT,
          config: wtConfig,
          logger: {
            info: (m) => progress('WORKTREE', m),
            warn: (m) => progress('WORKTREE', `⚠️ ${m}`),
            error: (m) => console.error(`[sprint-close] ${m}`),
          },
        });

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
    gitSpawn(PROJECT_ROOT, 'worktree', 'prune');

    // 3.0c Clear stale stashes — prevents dirty-tree errors during branch switching.
    progress('CLEANUP', 'Clearing stale git stashes...');
    const stashResult = gitSpawn(PROJECT_ROOT, 'stash', 'clear');
    if (stashResult.status !== 0) {
      console.warn(
        `⚠️ Warning: git stash clear failed (non-fatal): ${stashResult.stderr}`,
      );
    } else {
      progress('CLEANUP', '✅ Stash cleared.');
    }

    // 3.1 Enumerate all branches to delete (epic + matching stories/tasks)
    const epicBranch = `epic/${epicId}`;
    const storyLegacyPattern = `story/epic-${epicId}/`;
    const taskLegacyPattern = `task/epic-${epicId}/`;

    // Fetch all tickets linked to this epic to safely match v5 short story branches.
    const epicTickets = await provider.getTickets(epicId).catch(() => []);
    const validTicketIds = new Set(epicTickets.map((t) => t.id));

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

  progress('DONE', `🎉 Formal closure for Epic #${epicId} finished.`);
}

const progress = Logger.createProgress('sprint-close', { stderr: false });

main().catch((err) => {
  Logger.fatal(`sprint-close: ${err.message}`);
});
