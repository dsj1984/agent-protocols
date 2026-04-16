/**
 * Story lifecycle helpers shared between sprint-story-init and sprint-story-close.
 *
 * These three pure/IO-helpers capture the overlap previously duplicated across
 * the two CLI scripts — parsing the `Epic: #N` / `parent: #N` references out
 * of a Story body, fetching child `type::task` tickets, and batch-transitioning
 * those tasks to a target state label.
 *
 * The shape is narrow on purpose: init/close still own their own orchestration
 * (branch bootstrap, merge, cascade, notifications). Expanding this module to
 * cover those would over-abstract — they are genuinely different concerns.
 */

import {
  STATE_LABELS,
  transitionTicketState,
} from './orchestration/ticketing.js';

/**
 * Parse the `Epic: #N` and `parent: #N` references from a Story body.
 *
 * @param {string} body  Raw Story body Markdown.
 * @returns {{ epicId: number|null, featureId: number|null }}
 */
export function resolveStoryHierarchy(body) {
  const source = body ?? '';
  const epicMatch = source.match(/(?:^\s*epic:\s*#(\d+))/im);
  const parentMatch = source.match(/(?:^\s*parent:\s*#(\d+))/im);
  return {
    epicId: epicMatch ? parseInt(epicMatch[1], 10) : null,
    featureId: parentMatch ? parseInt(parentMatch[1], 10) : null,
  };
}

/**
 * Fetch the Story's direct children and return only those labelled
 * `type::task`. Epic/Story/Feature children are filtered out.
 *
 * @param {object} provider  ITicketingProvider instance.
 * @param {number} storyId   Story ticket number.
 * @returns {Promise<object[]>} Array of task tickets.
 */
export async function fetchChildTasks(provider, storyId) {
  const subTickets = await provider.getSubTickets(storyId);
  return subTickets.filter((t) => t.labels.includes('type::task'));
}

/**
 * Batch-transition a set of tickets to the target state label. Tickets
 * already carrying `STATE_LABELS.DONE` (or the target itself) are skipped.
 * Each transition runs in parallel; per-ticket failures are logged via the
 * provided `progress`/`onError` callbacks but do not abort the batch.
 *
 * @param {object} provider  ITicketingProvider instance.
 * @param {object[]} tickets Array of ticket objects with `id` and `labels`.
 * @param {string} targetLabel  Target `agent::...` label (e.g. STATE_LABELS.EXECUTING).
 * @param {object} [opts]
 * @param {(phase: string, message: string) => void} [opts.progress]  Progress reporter.
 * @param {(ticketId: number, err: Error) => void}  [opts.onError]     Per-failure callback.
 * @returns {Promise<{ transitioned: number[], skipped: number[], failed: number[] }>}
 */
export async function batchTransitionTickets(
  provider,
  tickets,
  targetLabel,
  opts = {},
) {
  const { progress, onError } = opts;
  const transitioned = [];
  const skipped = [];
  const failed = [];

  const concurrency = opts.concurrency ?? 10;

  const processTicket = async (ticket) => {
    if (ticket.labels.includes(targetLabel)) {
      progress?.('TICKETS', `  #${ticket.id} already ${targetLabel} — skipped`);
      skipped.push(ticket.id);
      return;
    }
    if (
      targetLabel !== STATE_LABELS.DONE &&
      ticket.labels.includes(STATE_LABELS.DONE)
    ) {
      progress?.('TICKETS', `  #${ticket.id} already done — skipped`);
      skipped.push(ticket.id);
      return;
    }
    try {
      await transitionTicketState(provider, ticket.id, targetLabel);
      progress?.('TICKETS', `  #${ticket.id} → ${targetLabel} ✅`);
      transitioned.push(ticket.id);
    } catch (err) {
      failed.push(ticket.id);
      if (onError) onError(ticket.id, err);
      else console.error(`  #${ticket.id} → FAILED: ${err.message}`);
    }
  };

  // Process in batches to avoid overwhelming the API with concurrent requests.
  for (let i = 0; i < tickets.length; i += concurrency) {
    const batch = tickets.slice(i, i + concurrency);
    await Promise.all(batch.map(processTicket));
  }

  return { transitioned, skipped, failed };
}
