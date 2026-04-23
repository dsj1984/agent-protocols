/**
 * Sprint Health Issue creation. Split out of dispatch-engine so the health
 * concern has a dedicated home.
 */

import { Logger } from '../Logger.js';
import { TYPE_LABELS } from '../label-constants.js';

/**
 * Ensure a Sprint Health issue exists for the Epic. Idempotent: no-op when
 * one is already present, and a silent no-op in dry-run mode.
 *
 * @param {number} epicId
 * @param {object} epic
 * @param {Array<object>} allTickets
 * @param {object} provider
 * @param {boolean} dryRun
 */
export async function ensureSprintHealthIssue(
  epicId,
  epic,
  allTickets,
  provider,
  dryRun,
) {
  if (dryRun) return;
  const healthIssue = allTickets.find(
    (t) =>
      t.labels.includes(TYPE_LABELS.HEALTH) ||
      t.title.startsWith('📉 Sprint Health:'),
  );

  if (!healthIssue) {
    Logger.info(`Creating Sprint Health issue for Epic #${epicId}...`);
    try {
      const { id } = await provider.createTicket(epicId, {
        epicId,
        title: `📉 Sprint Health: ${epic.title}`,
        body: `## Real-time Sprint Health Monitoring\n\nThis issue tracks the execution metrics, progress, and friction logs for this sprint.\n\n---\nparent: #${epicId}\nEpic: #${epicId}`,
        labels: [TYPE_LABELS.HEALTH],
        dependencies: [],
      });
      Logger.info(`✅ Sprint Health issue created: #${id}`);
    } catch (err) {
      Logger.warn(`Failed to create Sprint Health ticket: ${err.message}`);
    }
  }
}
