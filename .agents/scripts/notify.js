#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * notify.js
 *
 * Single dispatch entry point for orchestration notifications.
 *
 *   1. GITHUB COMMENT: posts to the ticket; @mentions operator for medium/high.
 *      Filtered by `notifications.commentMinLevel` (falls back to
 *      `notifications.minLevel`, default: medium). Callers may pass
 *      `opts.skipComment: true` to suppress the comment for a single dispatch
 *      while still firing the webhook (used for batched task-start fanout).
 *   2. WEBHOOK: fires when severity >= `notifications.minLevel` (default: medium).
 *
 * Severity vocabulary: low | medium | high. See `lib/notifications/notifier.js`
 * for full details and the `eventSeverity()` helper used by ticket-state-
 * transition events.
 */

import { createHmac } from 'node:crypto';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import {
  meetsMinLevel,
  resolveWebhookUrl,
  SEVERITY_RANK,
} from './lib/notifications/notifier.js';
import { createProvider } from './lib/provider-factory.js';

/** Map notification severity to a `postComment` badge style. */
const SEVERITY_TO_COMMENT_TYPE = {
  low: 'progress',
  medium: 'notification',
  high: 'friction',
};

function buildWebhookPayload({
  orchestration,
  ticketId,
  severity,
  message,
  operator,
}) {
  const cleanMessage = message.replace(operator, '').trim();
  const repo = orchestration.github?.repo;
  const numericTicketId = Number.parseInt(ticketId, 10);
  const prefix = severity === 'high' ? '[Action Required]' : `[${severity}]`;
  const ticketPart =
    Number.isFinite(numericTicketId) && numericTicketId > 0
      ? ` ${repo ? `${repo}#${numericTicketId}` : `#${numericTicketId}`}`
      : '';
  const text = `${prefix}${ticketPart}: ${cleanMessage}`;
  return JSON.stringify({ text });
}

async function sendWebhook(url, payloadBody) {
  const headers = { 'Content-Type': 'application/json' };
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = createHmac('sha256', webhookSecret)
      .update(payloadBody)
      .digest('hex');
    headers['X-Signature-256'] = `sha256=${signature}`;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payloadBody,
    });
    if (!res.ok) {
      console.warn(
        `[Notify] Webhook returned ${res.status}: ${await res.text().catch(() => '')}`,
      );
    }
  } catch (err) {
    console.warn(`[Notify] Failed to send webhook: ${err.message}`);
  }
}

/**
 * Dispatch a notification.
 *
 * @param {number} ticketId - GitHub Issue number to post the notification on.
 *   Pass 0 (or any non-positive) to skip the GitHub comment and fire the
 *   webhook only.
 * @param {{
 *   severity?: 'low'|'medium'|'high',
 *   message: string,
 * }} payload - `severity` defaults to `medium` when omitted.
 */
export async function notify(ticketId, payload, opts = {}) {
  const orchestration = opts.orchestration || resolveConfig().orchestration;
  const provider = opts.provider || createProvider(orchestration);

  const { severity = 'medium', message } = payload;
  if (!Object.hasOwn(SEVERITY_RANK, severity)) {
    throw new Error(
      `[Notify] Invalid severity "${severity}". Expected: low | medium | high.`,
    );
  }
  const operator = orchestration.github.operatorHandle || '@operator';
  const notifications = orchestration.notifications ?? {};
  const minLevel = notifications.minLevel;
  const commentMinLevel = notifications.commentMinLevel ?? minLevel;

  const numericId = Number.parseInt(ticketId, 10);
  const noTicket = Number.isNaN(numericId) || numericId <= 0;
  const callerSuppressed = opts.skipComment === true;
  const belowCommentMinLevel = !meetsMinLevel(severity, commentMinLevel);
  const skipGitHub = noTicket || callerSuppressed || belowCommentMinLevel;

  if (!skipGitHub) {
    console.log(
      `[Notify] Sending ${severity.toUpperCase()} to Issue #${numericId}...`,
    );

    // High always @mentions; medium @mentions when `mentionOperator` is set;
    // low never @mentions (it's filtered out at default minLevel anyway).
    const mention =
      severity === 'high' ||
      (severity === 'medium' && notifications.mentionOperator);
    const commentBody = mention ? `${operator} ${message}` : message;

    await provider.postComment(numericId, {
      body: commentBody,
      type: SEVERITY_TO_COMMENT_TYPE[severity],
    });
  } else if (noTicket) {
    console.log(
      `[Notify] Sending ${severity.toUpperCase()}... (Skipping GitHub comment — no ticket)`,
    );
  }

  if (meetsMinLevel(severity, minLevel)) {
    // `opts.webhookUrl === undefined` → resolve from process env.
    // Explicit `null` or string → caller was explicit; don't resolve.
    const webhookUrl =
      opts.webhookUrl === undefined ? resolveWebhookUrl() : opts.webhookUrl;
    if (webhookUrl) {
      console.log(`[Notify] Firing webhook (${severity}) to ${webhookUrl}...`);
      const payloadBody = buildWebhookPayload({
        orchestration,
        ticketId,
        severity,
        message,
        operator,
      });
      await sendWebhook(webhookUrl, payloadBody);
    }
  }
}

export function parseNotifyArgs(args) {
  if (args.length < 1) {
    Logger.fatal(
      'Usage: node notify.js [TicketId] <Message> [--severity low|medium|high]',
    );
  }

  let severity = 'medium';
  const sevIdx = args.indexOf('--severity');
  let working = args;
  if (sevIdx !== -1) {
    const raw = args[sevIdx + 1];
    if (!raw || !Object.hasOwn(SEVERITY_RANK, raw)) {
      Logger.fatal('[Notify] --severity requires one of: low | medium | high.');
    }
    severity = raw;
    working = args.filter((_a, i) => i !== sevIdx && i !== sevIdx + 1);
  }

  if (working.length === 0) {
    Logger.fatal('[Notify] Error: Message is required.');
  }

  let ticketId = 0;
  let message = '';
  const explicitTicketFlag = working.findIndex(
    (arg) => arg === '--ticket' || arg === '--issue',
  );

  if (explicitTicketFlag !== -1) {
    const rawTicketId = working[explicitTicketFlag + 1] ?? '';
    if (!/^\d+$/.test(rawTicketId)) {
      Logger.fatal('[Notify] Error: --ticket/--issue requires a numeric ID.');
    }
    ticketId = Number.parseInt(rawTicketId, 10);
    const positional = working.filter(
      (_arg, idx) =>
        idx !== explicitTicketFlag && idx !== explicitTicketFlag + 1,
    );
    message = positional.join(' ').trim();
  } else {
    const firstArg = working[0];
    const isNumeric = /^\d+$/.test(firstArg);

    if (isNumeric) {
      ticketId = Number.parseInt(firstArg, 10);
      message = working.slice(1).join(' ').trim();
    } else if (firstArg.startsWith('http')) {
      // Legacy: a leading URL was used as a sentinel; strip it.
      message = working.slice(1).join(' ').trim();
    } else {
      message = firstArg;
    }
  }

  if (!message) {
    Logger.fatal('[Notify] Error: Message is required.');
  }

  return { ticketId, message, severity };
}

async function main() {
  const args = process.argv.slice(2);
  const { ticketId, message, severity } = parseNotifyArgs(args);

  await notify(ticketId, { severity, message });
}

runAsCli(import.meta.url, main, { source: 'Notify' });
