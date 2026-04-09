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
      for (const ticket of contextTickets) {
        if (ticket.state === 'closed') continue;

        progress(
          'CONTEXT',
          `Closing ${ticket.labels.find((l) => l.startsWith('context::'))} #${ticket.id}...`,
        );
        await transitionTicketState(provider, ticket.id, STATE_LABELS.DONE);
        progress('CONTEXT', `✅ #${ticket.id} closed.`);
      }
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

    // 3.1 Delete Epic branch (local + remote)
    const epicBranch = `epic/${epicId}`;
    progress('CLEANUP', `Deleting ${epicBranch}...`);
    gitSpawn(PROJECT_ROOT, 'branch', '-D', epicBranch);
    gitSpawn(PROJECT_ROOT, 'push', 'origin', '--delete', epicBranch);

    // 3.2 Delete story branches
    progress('CLEANUP', 'Deleting story/task branches...');

    // Remote cleanup
    const remoteBranches = gitSpawn(PROJECT_ROOT, 'branch', '-r').stdout ?? '';
    const storyIdPattern = `story/epic-${epicId}/`;
    const taskIdPattern = `task/epic-${epicId}/`;

    remoteBranches.split('\n').forEach((line) => {
      const b = line.trim().replace('origin/', '');
      if (b.includes(storyIdPattern) || b.includes(taskIdPattern)) {
        progress('CLEANUP', `Deleting remote branch: ${b}`);
        gitSpawn(PROJECT_ROOT, 'push', 'origin', '--delete', b);
      }
    });

    // Local cleanup
    const localBranches = gitSpawn(PROJECT_ROOT, 'branch').stdout ?? '';
    localBranches.split('\n').forEach((line) => {
      const b = line.trim().replace('* ', '');
      if (b.includes(storyIdPattern) || b.includes(taskIdPattern)) {
        progress('CLEANUP', `Deleting local branch: ${b}`);
        gitSpawn(PROJECT_ROOT, 'branch', '-D', b);
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
