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
  // 1. Resolve and Close Context Tickets (PRD, Tech Spec)
  // -------------------------------------------------------------------------
  try {
    progress('CONTEXT', 'Searching for PRD and Tech Spec tickets...');
    const subTickets = await provider.getSubTickets(epicId);

    const contextTickets = subTickets.filter(
      (t) =>
        t.labels.includes('context::prd') ||
        t.labels.includes('context::tech-spec'),
    );

    if (contextTickets.length === 0) {
      progress('CONTEXT', 'No open PRD/Tech Spec tickets found.');
    } else {
      await Promise.all(
        contextTickets.map(async (ticket) => {
          if (ticket.state === 'closed') return;

          progress(
            'CONTEXT',
            `Closing ${ticket.labels.find((l) => l.startsWith('context::'))} #${ticket.id}...`,
          );
          await transitionTicketState(provider, ticket.id, STATE_LABELS.DONE);
          progress('CONTEXT', `✅ #${ticket.id} closed.`);
        }),
      );
    }
  } catch (err) {
    console.warn(
      `⚠️ Warning: Failed to process context tickets: ${err.message}`,
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

    // 3.0 Clear stale stashes — prevents dirty-tree errors during branch switching.
    progress('CLEANUP', 'Clearing stale git stashes...');
    const stashResult = gitSpawn(PROJECT_ROOT, 'stash', 'clear');
    if (stashResult.status !== 0) {
      console.warn(
        `⚠️ Warning: git stash clear failed (non-fatal): ${stashResult.stderr}`,
      );
    } else {
      progress('CLEANUP', '✅ Stash cleared.');
    }

    // 3.1 Delete Epic branch (local + remote)
    const epicBranch = `epic/${epicId}`;
    progress('CLEANUP', `Deleting ${epicBranch}...`);
    gitSpawn(PROJECT_ROOT, 'branch', '-D', epicBranch);
    try {
      const remoteDelResult = gitSpawn(
        PROJECT_ROOT,
        'push',
        'origin',
        '--delete',
        epicBranch,
      );
      if (remoteDelResult.status !== 0) {
        console.warn(
          `⚠️ Warning: Could not delete remote ${epicBranch} (may not exist): ${remoteDelResult.stderr}`,
        );
      }
    } catch (err) {
      console.warn(
        `⚠️ Warning: Remote deletion of ${epicBranch} threw: ${err.message}`,
      );
    }

    // 3.2 Delete story branches
    progress('CLEANUP', 'Deleting story/task branches...');

    // Remote cleanup — match both v5 (`story-{id}`) and legacy (`story/epic-{epicId}/`) patterns
    const remoteBranches = gitSpawn(PROJECT_ROOT, 'branch', '-r').stdout ?? '';
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

    remoteBranches.split('\n').forEach((line) => {
      const b = line.trim().replace('origin/', '');
      if (matchesEpicBranch(b)) {
        progress('CLEANUP', `Deleting remote branch: ${b}`);
        try {
          const result = gitSpawn(
            PROJECT_ROOT,
            'push',
            'origin',
            '--delete',
            b,
          );
          if (result.status !== 0) {
            console.warn(
              `⚠️ Warning: Could not delete remote branch ${b} (may not exist): ${result.stderr}`,
            );
          }
        } catch (err) {
          console.warn(
            `⚠️ Warning: Remote deletion of ${b} threw: ${err.message}`,
          );
        }
      }
    });

    // Local cleanup
    const localBranches = gitSpawn(PROJECT_ROOT, 'branch').stdout ?? '';
    localBranches.split('\n').forEach((line) => {
      const b = line.trim().replace('* ', '');
      if (matchesEpicBranch(b)) {
        progress('CLEANUP', `Deleting local branch: ${b}`);
        try {
          const result = gitSpawn(PROJECT_ROOT, 'branch', '-D', b);
          if (result.status !== 0) {
            console.warn(
              `⚠️ Warning: Could not delete local branch ${b}: ${result.stderr}`,
            );
          }
        } catch (err) {
          console.warn(
            `⚠️ Warning: Local deletion of ${b} threw: ${err.message}`,
          );
        }
      }
    });

    // 3.3 Prune
    gitSpawn(PROJECT_ROOT, 'fetch', '--prune');
    progress('CLEANUP', '✅ Branch cleanup complete.');
  }

  progress('DONE', `🎉 Formal closure for Epic #${epicId} finished.`);
}

const progress = Logger.createProgress('sprint-close', { stderr: false });

main().catch((err) => {
  Logger.fatal(`sprint-close: ${err.message}`);
});
