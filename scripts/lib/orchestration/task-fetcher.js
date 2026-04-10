/**
 * lib/orchestration/task-fetcher.js — Task Fetching and Parsing Helpers
 */

import { parseBlockedBy, parseTaskMetadata } from '../dependency-parser.js';
import { STATE_LABELS } from './ticketing.js';

const AGENT_DONE_LABEL = STATE_LABELS.DONE;
const RISK_HIGH_LABEL = 'risk::high';
const TYPE_TASK_LABEL = 'type::task';

/**
 * Parses normal ticket objects into task representations.
 *
 * @param {object[]} tickets
 * @returns {object[]}
 */
export function parseTasks(tickets) {
  return tickets.map((t) => {
    const metadata = parseTaskMetadata(t.body ?? '');
    const blockedBy = parseBlockedBy(t.body ?? '');
    const labels = t.labels ?? [];

    const status =
      t.state === 'closed'
        ? AGENT_DONE_LABEL
        : (labels.find((l) => l.startsWith('agent::')) ?? 'agent::ready');

    const isRiskHigh = labels.includes(RISK_HIGH_LABEL);

    return {
      id: t.id,
      title: t.title,
      labels,
      status,
      isRiskHigh,
      dependsOn: blockedBy,
      body: t.body ?? '',
      ...metadata,
    };
  });
}

/**
 * Fetch all Task-level tickets under an Epic, normalised for the dispatcher.
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} epicId
 * @returns {Promise<object[]>}
 */
export async function fetchTasks(provider, epicId) {
  const tickets = await provider.getTickets(epicId, { label: TYPE_TASK_LABEL });
  return parseTasks(tickets);
}
