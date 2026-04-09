#!/usr/bin/env node

/**
 * notify.js
 *
 * Dual-channel notification engine for v5 Orchestration.
 * 1. INFO: @mention the operator handle on a GitHub issue.
 * 2. ACTION: Fire a webhook for HITL (Human-In-The-Loop) events.
 */

import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

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

  const numericId = parseInt(ticketId, 10);
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

  // 2. Webhook for Actions (HITL)
  if (type === 'action' || actionRequired) {
    const webhookUrl = orchestration.notifications?.webhookUrl;
    if (webhookUrl) {
      console.log(`[Notify] Firing Action Webhook to ${webhookUrl}...`);
      try {
        const payloadBody = JSON.stringify({
          ticketId,
          event: 'HITL_ACTION_REQUIRED',
          message: message.replace(operator, '').trim(),
          timestamp: new Date().toISOString(),
        });
        const headers = { 'Content-Type': 'application/json' };

        // H-4: Optional HMAC-SHA256 signing for webhook authenticity.
        const webhookSecret = process.env.WEBHOOK_SECRET;
        if (webhookSecret) {
          const signature = createHmac('sha256', webhookSecret)
            .update(payloadBody)
            .digest('hex');
          headers['X-Signature-256'] = `sha256=${signature}`;
        }

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: payloadBody,
        });
        // M-10: Check response status instead of silently swallowing errors.
        if (!res.ok) {
          console.warn(
            `[Notify] Webhook returned ${res.status}: ${await res.text().catch(() => '')}`,
          );
        }
      } catch (err) {
        console.warn(`[Notify] Failed to send webhook: ${err.message}`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    Logger.fatal('Usage: node notify.js [TicketId] <Message> [--action]');
  }

  let ticketId = 0;
  let message = '';
  const isAction = args.includes('--action');

  // Detect if first arg is a ticket ID or a message (or a legacy URL)
  const firstArg = args[0];
  const isNumeric = /^\d+$/.test(firstArg);

  if (isNumeric) {
    ticketId = parseInt(firstArg, 10);
    message = args[1] || '';
  } else {
    // If first arg is a URL or a string, treat it as the "skip-id" mode
    // (Legacy calls pass a URL here, we skip it and find the message)
    if (firstArg.startsWith('http')) {
      message = args[1] || '';
    } else {
      message = firstArg;
    }
  }

  if (!message) {
    Logger.fatal('[Notify] Error: Message is required.');
  }

  await notify(ticketId, {
    type: isAction ? 'action' : 'notification',
    message,
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    Logger.fatal(`[Notify] Fatal error: ${err.message}`);
  });
}
