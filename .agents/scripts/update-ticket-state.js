import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';

const STATE_LABELS = {
  READY: 'agent::ready',
  EXECUTING: 'agent::executing',
  REVIEW: 'agent::review',
  DONE: 'agent::done',
};

const ALL_STATES = Object.values(STATE_LABELS);

let cachedProvider = null;

export function getProvider() {
  // If we are in a testing environment or manually injected, return that
  if (cachedProvider) return cachedProvider;

  const config = resolveConfig();
  cachedProvider = createProvider(config.orchestration);
  return cachedProvider;
}

/**
 * Used for dependency injection during unit tests.
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 */
export function setProvider(provider) {
  cachedProvider = provider;
}

export function resetProvider() {
  cachedProvider = null;
}

/**
 * Transitions a ticket's label to the new state.
 * Removes other agent:: state labels.
 *
 * @param {number} ticketId
 * @param {string} newState - Must be one of STATE_LABELS.
 */
export async function transitionTicketState(ticketId, newState) {
  if (!ALL_STATES.includes(newState)) {
    throw new Error(`Invalid state: ${newState}`);
  }

  const provider = getProvider();

  const toRemove = ALL_STATES.filter((state) => state !== newState);

  // Closing/reopening mirrors the label state so GitHub shows the correct
  // issue state without requiring a separate manual close step.
  const isDone = newState === STATE_LABELS.DONE;

  await provider.updateTicket(ticketId, {
    labels: {
      add: [newState],
      remove: toRemove,
    },
    state: isDone ? 'closed' : 'open',
    state_reason: isDone ? 'completed' : null,
  });
}

/**
 * Mutates the tasklist checkbox in the parent's body.
 * E.g., `- [ ] #123` to `- [x] #123`
 *
 * @param {number} ticketId - ID of parent ticket
 * @param {number} subIssueId - ID of child ticket
 * @param {boolean} checked
 */
export async function toggleTasklistCheckbox(ticketId, subIssueId, checked) {
  const provider = getProvider();
  const ticket = await provider.getTicket(ticketId);
  const body = ticket.body || '';

  if (!body.includes(`#${subIssueId}`)) {
    return; // sub-issue not directly referenced in body
  }

  const targetBox = checked ? '- [x]' : '- [ ]';

  let newBody = body;

  if (checked) {
    // replace `- [ ] #123` or `- [] #123` with `- [x] #123`
    const re = new RegExp(`-\\s*\\[\\s*\\]\\s+#${subIssueId}\\b`, 'g');
    newBody = newBody.replace(re, `${targetBox} #${subIssueId}`);
  } else {
    // replace `- [x] #123` or `- [X] #123` with `- [ ] #123`
    const re = new RegExp(`-\\s*\\[[xX]\\]\\s+#${subIssueId}\\b`, 'g');
    newBody = newBody.replace(re, `${targetBox} #${subIssueId}`);
  }

  if (newBody !== body) {
    await provider.updateTicket(ticketId, {
      body: newBody,
    });
  }
}

/**
 *
 * @param {number} ticketId
 * @param {'progress'|'friction'|'notification'} type
 * @param {string} payload
 */
export async function postStructuredComment(ticketId, type, payload) {
  const provider = getProvider();
  await provider.postComment(ticketId, {
    type,
    body: payload,
  });
}

/**
 * Recursively cascade upward.
 * If ticket reaches DONE, it toggles its checkbox in its parent (parsed from dependency blocks or Epic hierarchy).
 * Then checks if parent's sub-tickets are ALL DONE.
 * If yes, transitions parent to DONE and cascades up.
 *
 * @param {number} ticketId
 */
export async function cascadeCompletion(ticketId) {
  const provider = getProvider();
  const ticket = await provider.getTicket(ticketId);

  // Determine if this ticket is agent::done
  if (!ticket.labels.includes(STATE_LABELS.DONE)) {
    return;
  }

  const { blocks: parentIds } = await provider.getTicketDependencies(ticketId);

  // Fallback: parse `parent: #NNN` from the body when `blocks` syntax isn't used (C-5).
  let parsedParents = parentIds;
  if (!parsedParents || parsedParents.length === 0) {
    const parentMatch = ticket.body
      ? [...ticket.body.matchAll(/parent:\s*#(\d+)/gi)]
      : [];
    parsedParents = parentMatch.map((m) => parseInt(m[1], 10));
  }

  for (const parentId of parsedParents) {
    // Mark checked in parent body
    await toggleTasklistCheckbox(parentId, ticketId, true);

    const subTickets = await provider.getSubTickets(parentId);

    // Check if ALL are done
    const allDone =
      subTickets.length > 0 &&
      subTickets.every(
        (st) => st.labels.includes(STATE_LABELS.DONE) || st.state === 'closed',
      );

    if (allDone) {
      await transitionTicketState(parentId, STATE_LABELS.DONE);
      await postStructuredComment(
        parentId,
        'progress',
        'All child tickets completed via recursive cascade.',
      );

      // recursive cascade
      await cascadeCompletion(parentId);
    }
  }
}

// ── CLI Main Block ────────────────────────────────────────────────────────
// If run directly via node .agents/scripts/update-ticket-state.js
if (
  process.argv[1]?.endsWith('update-ticket-state.js') ||
  process.env.DEBUG_MAIN // For local debugging
) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      task: { type: 'string' },
      state: { type: 'string' },
    },
  });

  const taskId = parseInt(values.task, 10);
  const state = values.state;

  if (Number.isNaN(taskId) || !state) {
    console.error(
      'Usage: node update-ticket-state.js --task <id> --state <agent::...>',
    );
    process.exit(1);
  }

  (async () => {
    try {
      console.log(
        `[State-Sync] Transitioning ticket #${taskId} to ${state}...`,
      );
      await transitionTicketState(taskId, state);

      if (state === STATE_LABELS.DONE) {
        console.log(`[State-Sync] Cascading completion from #${taskId}...`);
        await cascadeCompletion(taskId);
      }

      console.log('[State-Sync] ✅ Success');
    } catch (err) {
      console.error(`[State-Sync] ❌ Failed: ${err.message}`);
      process.exit(1);
    }
  })();
}
