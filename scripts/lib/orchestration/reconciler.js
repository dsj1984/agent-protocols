/**
 * lib/orchestration/reconciler.js — Ticket Hierarchy Reconciliation
 */

import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { VerboseLogger } from '../VerboseLogger.js';
import { parseParentId } from './story-grouper.js';
import { STATE_LABELS } from './ticketing.js';

const { settings: globalSettings } = resolveConfig();
const vlog = VerboseLogger.init(globalSettings, PROJECT_ROOT, {
  source: 'dispatcher',
});

const AGENT_DONE_LABEL = STATE_LABELS.DONE;

/**
 * Reconcile closed GitHub issues that still have stale `agent::` labels.
 *
 * For every task that is already closed (`status === agent::done`) but
 * missing the `agent::done` label, rewrites labels to the canonical set and
 * sets `state_reason: completed`. Provider failures are logged and swallowed
 * — reconciliation must never break the dispatch cycle.
 *
 * @param {object[]} tasks                                              Parsed task records.
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider  Ticketing provider.
 * @param {boolean} dryRun                                              When true, log intent without mutating.
 * @returns {Promise<void>}
 */
export async function reconcileClosedTasks(tasks, provider, dryRun) {
  const ALL_AGENT_STATES = Object.values(STATE_LABELS);

  for (const task of tasks) {
    if (task.status !== AGENT_DONE_LABEL) continue;
    if ((task.labelSet ?? new Set(task.labels)).has(AGENT_DONE_LABEL)) continue;

    vlog.info(
      'orchestration',
      `Reconciling closed issue #${task.id} "${task.title}" → agent::done`,
    );

    if (dryRun) {
      vlog.info(
        'orchestration',
        `[DRY-RUN] Would sync labels and close issue #${task.id}`,
      );
      continue;
    }

    try {
      await provider.updateTicket(task.id, {
        labels: {
          add: [AGENT_DONE_LABEL],
          remove: [
            ...ALL_AGENT_STATES.filter((s) => s !== AGENT_DONE_LABEL),
            'agent::blocked',
          ],
        },
        state: 'closed',
        state_reason: 'completed',
      });
      vlog.info('orchestration', `✅ Synced #${task.id} to agent::done`);
    } catch (err) {
      vlog.warn(
        'orchestration',
        `Failed to reconcile #${task.id}: ${err.message}`,
      );
    }
  }
}

/**
 * Reconcile the ticket hierarchy bottom-up (Tasks → Stories → Features).
 *
 * Walks every Story and Feature under the Epic; if all children of a
 * container are done, closes the container and applies `agent::done`.
 *
 * Epic auto-closure is intentionally excluded — Epics close only through
 * the formal `/sprint-close` workflow.
 *
 * Per-ticket provider failures are logged and swallowed so a single bad
 * ticket cannot halt reconciliation across the rest of the graph.
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider  Ticketing provider.
 * @param {number} _epicId                                               Epic id (reserved — currently unused; kept for call-site stability).
 * @param {object} _epic                                                 Epic ticket record (reserved — currently unused).
 * @param {object[]} tasks                                               Parsed task records.
 * @param {object[]} allTickets                                          Every ticket under the Epic.
 * @param {boolean} dryRun                                               When true, mutate nothing.
 * @returns {Promise<void>}
 */
export async function reconcileHierarchy(
  provider,
  _epicId,
  _epic,
  tasks,
  allTickets,
  dryRun,
) {
  const ticketMap = new Map(allTickets.map((t) => [t.id, t]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const childrenOf = new Map();
  for (const ticket of allTickets) {
    const parentId = parseParentId(ticket.body);
    if (parentId != null) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId).push(ticket.id);
    }
  }

  function isDone(ticketId) {
    if (taskById.has(ticketId)) {
      return taskById.get(ticketId).status === AGENT_DONE_LABEL;
    }
    const t = ticketMap.get(ticketId);
    if (!t) return false;
    return (
      t.state === 'closed' ||
      (t.labelSet ?? new Set(t.labels)).has(AGENT_DONE_LABEL)
    );
  }

  async function maybeClose(id, typeName) {
    const ticket = ticketMap.get(id);
    if (!ticket || ticket.state === 'closed') return;
    const children = childrenOf.get(id) ?? [];
    if (children.length === 0) return;
    if (!children.every((cid) => isDone(cid))) return;

    vlog.info(
      'orchestration',
      `All children of ${typeName} #${id} "${ticket.title}" are done. Closing...`,
    );

    if (dryRun) {
      vlog.info(
        'orchestration',
        `[DRY-RUN] Would close ${typeName} #${id} and set agent::done.`,
      );
      ticket.state = 'closed';
      return;
    }

    try {
      await provider.updateTicket(id, {
        labels: {
          add: [AGENT_DONE_LABEL],
          remove: ['agent::ready', 'agent::executing', 'agent::review'],
        },
        state: 'closed',
        state_reason: 'completed',
      });
      ticket.state = 'closed';
      vlog.info(
        'orchestration',
        `✅ ${typeName} #${id} closed and marked agent::done.`,
      );
    } catch (err) {
      vlog.warn(
        'orchestration',
        `Failed to close ${typeName} #${id}: ${err.message}`,
      );
    }
  }

  const storyIds = allTickets
    .filter((t) => (t.labelSet ?? new Set(t.labels)).has('type::story'))
    .map((t) => t.id);
  const featureIds = allTickets
    .filter((t) => (t.labelSet ?? new Set(t.labels)).has('type::feature'))
    .map((t) => t.id);

  for (const id of storyIds) await maybeClose(id, 'Story');
  for (const id of featureIds) await maybeClose(id, 'Feature');

  // EXCLUSION: Epic auto-closure removed.
  // The Epic ticket now stays open until the formal /sprint-close workflow is executed.
}
