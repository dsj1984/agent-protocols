/**
 * lib/orchestration/ticketing.js — Ticketing Operations SDK
 *
 * Stateless logic for updating ticket states, toggling checkboxes,
 * posting comments, and cascading completions.
 *
 * This module is the SDK layer — it delegates all API calls to the
 * provided ITicketingProvider instance.
 */

export const STATE_LABELS = {
  READY: 'agent::ready',
  EXECUTING: 'agent::executing',
  REVIEW: 'agent::review',
  DONE: 'agent::done',
};

const ALL_STATES = Object.values(STATE_LABELS);

/**
 * Transitions a ticket's label to the new state.
 * Removes other agent:: state labels.
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} ticketId
 * @param {string} newState - Must be one of STATE_LABELS.
 */
export async function transitionTicketState(provider, ticketId, newState) {
  if (!ALL_STATES.includes(newState)) {
    throw new Error(`Invalid state: ${newState}`);
  }

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

  // Automatically trigger upward cascade when a ticket is completed.
  // This ensures parents (Stories, Features) close as soon as their last
  // child is marked done.
  if (isDone) {
    await cascadeCompletion(provider, ticketId);
  }
}

/**
 * Mutates the tasklist checkbox in the parent's body.
 * E.g., `- [ ] #123` to `- [x] #123`
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} ticketId - ID of parent ticket
 * @param {number} subIssueId - ID of child ticket
 * @param {boolean} checked
 */
export async function toggleTasklistCheckbox(
  provider,
  ticketId,
  subIssueId,
  checked,
) {
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
 * Post a structured comment to a ticket.
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} ticketId
 * @param {'progress'|'friction'|'notification'} type
 * @param {string} payload
 */
export async function postStructuredComment(provider, ticketId, type, payload) {
  await provider.postComment(ticketId, {
    type,
    body: payload,
  });
}

/**
 * Recursively cascade upward.
 * If ticket reaches DONE, it toggles its checkbox in its parent.
 * Then checks if parent's sub-tickets are ALL DONE.
 * If yes, transitions parent to DONE and cascades up.
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} ticketId
 */
export async function cascadeCompletion(provider, ticketId) {
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
    await toggleTasklistCheckbox(provider, parentId, ticketId, true);

    const subTickets = await provider.getSubTickets(parentId);

    // Check if ALL are done. 
    // If a ticket reached this point, it means it's one of the sub-tickets 
    // that just finished, so subTickets.length will be at least 1.
    const allDone = subTickets.every(
      (st) => st.labels.includes(STATE_LABELS.DONE) || st.state === 'closed',
    );

    if (allDone) {
      // EXCLUSION: Do not auto-close Epics, PRDs, or Tech Specs via cascade.
      // These must be closed via formal sprint-close.
      const parent = await provider.getTicket(parentId);
      const isEpic = parent.labels.includes('type::epic');
      const isPlanning =
        parent.labels.includes('context::prd') ||
        parent.labels.includes('context::tech-spec');

      if (isEpic || isPlanning) {
        console.warn(
          `[Ticketing] Cascade reached ${isEpic ? 'Epic' : 'Planning'} #${parentId}. Skipping auto-close (reserved for sprint-close).`,
        );
        continue;
      }

      await transitionTicketState(provider, parentId, STATE_LABELS.DONE);
      await postStructuredComment(
        provider,
        parentId,
        'progress',
        'All child tickets completed via recursive cascade.',
      );

      // recursive cascade
      await cascadeCompletion(provider, parentId);
    }
  }
}
