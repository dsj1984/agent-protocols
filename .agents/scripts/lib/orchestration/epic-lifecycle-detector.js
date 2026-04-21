/**
 * Epic-completion detection + bookend lifecycle trigger. Posts the summary
 * comment on the Epic and fires the operator webhook when every Task under
 * the Epic has landed as `agent::done`.
 */

import { notify } from '../../notify.js';
import { vlog } from './dispatch-logger.js';
import { STATE_LABELS } from './ticketing.js';

const AGENT_DONE_LABEL = STATE_LABELS.DONE;

/**
 * Detect Epic completion and fire the bookend lifecycle.
 *
 * @param {{
 *   epicId: number,
 *   epic?: object,
 *   tasks: Array<object>,
 *   manifest: object,
 *   provider: object,
 *   settings: object,
 *   dryRun: boolean,
 * }} params
 */
/* node:coverage ignore next */
export async function detectEpicCompletion({
  epicId,
  epic: _epic,
  tasks,
  manifest,
  provider,
  settings,
  dryRun,
}) {
  if (tasks.length === 0) return;
  const allDone = tasks.every((t) => t.status === AGENT_DONE_LABEL);
  if (!allDone) return;

  vlog.info(
    'orchestration',
    `🎉 All Tasks under Epic #${epicId} are agent::done. Starting Bookend Lifecycle.`,
  );

  if (dryRun) {
    vlog.info(
      'orchestration',
      '[DRY-RUN] Would post epic-complete comment and fire webhook.',
    );
    return;
  }

  const taskLines = tasks.map((t) => `- ✅ #${t.id}: ${t.title}`).join('\n');
  const summaryComment = [
    `## 🎉 Epic #${epicId} Complete`,
    '',
    `All **${tasks.length}** tasks have been implemented and reviewed.`,
    '',
    '### Completed Tasks',
    taskLines,
    '',
    '### ⚠️ NEXT ACTIONS — Manual Bookend Lifecycle',
    'The dispatcher does **not** auto-run bookend phases. The operator (or a',
    'follow-up agent) must invoke each slash command in order:',
    '',
    `1. \`/audit-quality ${epicId}\` — QA audit`,
    `2. \`/sprint-code-review ${epicId}\` — Mandatory code review gate`,
    `3. \`/sprint-retro ${epicId}\` — Generate retrospective (posted as an Epic comment)`,
    `4. \`/sprint-close ${epicId}\` — Merge, tag, close (gated on retro existence)`,
    '',
    'Skipping `/sprint-retro` will cause `/sprint-close` to halt at the',
    'Retrospective Gate (Step 1.5).',
    '',
    `> Progress: ${manifest.summary.progressPercent}% · Generated: ${manifest.generatedAt}`,
  ].join('\n');

  try {
    await provider.postComment(epicId, {
      body: summaryComment,
      type: 'notification',
    });
    vlog.info(
      'orchestration',
      `Posted epic-complete summary comment on Epic #${epicId}.`,
    );
  } catch (err) {
    vlog.warn(
      'orchestration',
      `Failed to post epic-complete comment: ${err.message}`,
    );
  }

  if (settings.notificationWebhookUrl) {
    try {
      await notify(
        epicId,
        {
          type: 'notification',
          message: `Epic #${epicId} complete. All tasks done. Bookend Lifecycle starting.`,
        },
        {
          orchestration: {
            github: { operatorHandle: '' },
            notifications: { webhookUrl: settings.notificationWebhookUrl },
          },
        },
      );
    } catch (err) {
      vlog.warn(
        'orchestration',
        `Webhook notification failed (non-fatal): ${err.message}`,
      );
    }
  }
}
