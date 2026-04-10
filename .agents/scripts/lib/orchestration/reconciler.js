/**
 * lib/orchestration/reconciler.js — Ticket Hierarchy Reconciliation
 */

import { VerboseLogger } from '../VerboseLogger.js';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { parseParentId } from './story-grouper.js';
import { STATE_LABELS } from './ticketing.js';

const { settings: globalSettings } = resolveConfig();
const vlog = VerboseLogger.init(globalSettings, PROJECT_ROOT, {
  source: 'dispatcher',
});

const AGENT_DONE_LABEL = STATE_LABELS.DONE;

/**
 * Reconcile closed GitHub issues that still have stale agent:: labels.
 *
 * @param {object[]} tasks
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {boolean} dryRun
 */
export async function reconcileClosedTasks(tasks, provider, dryRun) {
  const ALL_AGENT_STATES = Object.values(STATE_LABELS);

  for (const task of tasks) {
    if (task.status !== AGENT_DONE_LABEL) continue;
    if (task.labels.includes(AGENT_DONE_LABEL)) continue;

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
          remove: ALL_AGENT_STATES.filter((s) => s !== AGENT_DONE_LABEL),
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
 * Reconcile the full ticket hierarchy bottom-up (Tasks → Stories → Features → Epic).
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} epicId
 * @param {object} epic
 * @param {object[]} tasks
 * @param {object[]} allTickets
 * @param {boolean} dryRun
 */
export async function reconcileHierarchy(
  provider,
  epicId,
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
    return t.state === 'closed' || (t.labels ?? []).includes(AGENT_DONE_LABEL);
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
    .filter((t) => (t.labels ?? []).includes('type::story'))
    .map((t) => t.id);
  const featureIds = allTickets
    .filter((t) => (t.labels ?? []).includes('type::feature'))
    .map((t) => t.id);

  for (const id of storyIds) await maybeClose(id, 'Story');
  for (const id of featureIds) await maybeClose(id, 'Feature');

  // EXCLUSION: Epic auto-closure removed.
  // The Epic ticket now stays open until the formal /sprint-close workflow is executed.
}
