#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * notify.js
 *
 * Dual-channel notification engine for v5 Orchestration.
 * 1. INFO: @mention the operator handle on a GitHub issue.
 * 2. WEBHOOK: Fire the configured webhook for any notify() call whose type
 *    meets `notifications.webhookMinLevel` (default: progress — everything).
 */

import { createHmac } from 'node:crypto';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { resolveWebhookUrl } from './lib/notifications/notifier.js';
import { createProvider } from './lib/provider-factory.js';

const LEVEL_RANK = { progress: 0, notification: 1, friction: 2, action: 3 };

function shouldFireWebhook(orchestration, type, actionEscalated) {
  const minRank =
    LEVEL_RANK[orchestration.notifications?.webhookMinLevel] ??
    LEVEL_RANK.progress;
  const typeRank = LEVEL_RANK[type] ?? LEVEL_RANK.notification;
  const effectiveRank = actionEscalated
    ? Math.max(typeRank, LEVEL_RANK.action)
    : typeRank;
  return effectiveRank >= minRank;
}

function buildWebhookPayload({
  orchestration,
  ticketId,
  type,
  message,
  operator,
  isAction,
}) {
  return JSON.stringify({
    repo: orchestration.github?.repo ?? null,
    ticketId,
    type,
    event: isAction ? 'HITL_ACTION_REQUIRED' : type,
    actionRequired: isAction,
    message: message.replace(operator, '').trim(),
    timestamp: new Date().toISOString(),
  });
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
 * @param {{
 *   type: 'progress'|'friction'|'notification'|'action',
 *   message: string,
 *   actionRequired?: boolean
 * }} payload
 */
export async function notify(ticketId, payload, opts = {}) {
  const orchestration = opts.orchestration || resolveConfig().orchestration;
  const provider = opts.provider || createProvider(orchestration);

  const { type, message, actionRequired } = payload;
  const operator = orchestration.github.operatorHandle || '@operator';

  const numericId = Number.parseInt(ticketId, 10);
  const skipGitHub = Number.isNaN(numericId) || numericId <= 0;

  if (!skipGitHub) {
    console.log(
      `[Notify] Sending ${type.toUpperCase()} to Issue #${numericId}...`,
    );

    // 1. Mentions for Info/Notification
    let commentBody = message;
    if (
      type === 'notification' ||
      (type === 'action' && orchestration.notifications?.mentionOperator)
    ) {
      commentBody = `${operator} ${message}`;
    }

    await provider.postComment(numericId, {
      body: commentBody,
      type: type === 'action' ? 'notification' : type,
    });
  } else {
    console.log(
      `[Notify] Sending ${type.toUpperCase()}... (Skipping GitHub comment)`,
    );
  }

  // 2. Webhook for any event that meets the configured minimum level.
  const actionEscalated = Boolean(actionRequired);
  if (shouldFireWebhook(orchestration, type, actionEscalated)) {
    // `opts.webhookUrl === undefined` → resolve from env/.mcp.json.
    // Explicit `null` or string → caller was explicit; don't resolve.
    const webhookUrl =
      opts.webhookUrl === undefined ? resolveWebhookUrl() : opts.webhookUrl;
    if (webhookUrl) {
      console.log(`[Notify] Firing webhook (${type}) to ${webhookUrl}...`);
      const payloadBody = buildWebhookPayload({
        orchestration,
        ticketId,
        type,
        message,
        operator,
        isAction: type === 'action' || actionEscalated,
      });
      await sendWebhook(webhookUrl, payloadBody);
    }
  }
}

export function parseNotifyArgs(args) {
  if (args.length < 1) {
    Logger.fatal('Usage: node notify.js [TicketId] <Message> [--action]');
  }

  const isAction = args.includes('--action');
  const filteredArgs = args.filter((arg) => arg !== '--action');
  if (filteredArgs.length === 0) {
    Logger.fatal('[Notify] Error: Message is required.');
  }

  let ticketId = 0;
  let message = '';
  const explicitTicketFlag = filteredArgs.findIndex(
    (arg) => arg === '--ticket' || arg === '--issue',
  );

  if (explicitTicketFlag !== -1) {
    const rawTicketId = filteredArgs[explicitTicketFlag + 1] ?? '';
    if (!/^\d+$/.test(rawTicketId)) {
      Logger.fatal('[Notify] Error: --ticket/--issue requires a numeric ID.');
    }
    ticketId = Number.parseInt(rawTicketId, 10);
    const positional = filteredArgs.filter(
      (_arg, idx) =>
        idx !== explicitTicketFlag && idx !== explicitTicketFlag + 1,
    );
    message = positional.join(' ').trim();
  } else {
    // Detect if first arg is a ticket ID or a message (or a legacy URL)
    const firstArg = filteredArgs[0];
    const isNumeric = /^\d+$/.test(firstArg);

    if (isNumeric) {
      ticketId = Number.parseInt(firstArg, 10);
      message = filteredArgs.slice(1).join(' ').trim();
    } else {
      // If first arg is a URL or a string, treat it as the "skip-id" mode
      // (Legacy calls pass a URL here, we skip it and find the message)
      if (firstArg.startsWith('http')) {
        message = filteredArgs.slice(1).join(' ').trim();
      } else {
        message = firstArg;
      }
    }
  }

  if (!message) {
    Logger.fatal('[Notify] Error: Message is required.');
  }

  return { ticketId, message, isAction };
}

async function main() {
  const args = process.argv.slice(2);
  const { ticketId, message, isAction } = parseNotifyArgs(args);

  await notify(ticketId, {
    type: isAction ? 'action' : 'notification',
    message,
  });
}

runAsCli(import.meta.url, main, { source: 'Notify' });
