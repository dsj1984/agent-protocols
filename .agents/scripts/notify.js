#!/usr/bin/env node
/**
 * notify.js
 *
 * Dual-channel notification engine for v5 Orchestration.
 * 1. INFO: @mention the operator handle on a GitHub issue.
 * 2. ACTION: Fire a webhook for HITL (Human-In-The-Loop) events.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProvider } from './lib/provider-factory.js';
import { resolveConfig } from './lib/config-resolver.js';

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

  console.log(`[Notify] Sending ${type.toUpperCase()} to Issue #${ticketId}...`);

  // 1. Mentions for Info/Notification
  let commentBody = message;
  if (type === 'notification' || (type === 'action' && orchestration.notifications?.mentionOperator)) {
    commentBody = `${operator} ${message}`;
  }

  await provider.postComment(ticketId, {
    body: commentBody,
    type: type === 'action' ? 'notification' : type
  });

  // 2. Webhook for Actions (HITL)
  if (type === 'action' || actionRequired) {
    const webhookUrl = orchestration.notifications?.webhookUrl;
    if (webhookUrl) {
      console.log(`[Notify] Firing Action Webhook to ${webhookUrl}...`);
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId,
            event: 'HITL_ACTION_REQUIRED',
            message: message.replace(operator, '').trim(),
            timestamp: new Date().toISOString()
          })
        });
      } catch (err) {
        console.warn(`[Notify] Failed to send webhook: ${err.message}`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node notify.js <TicketId> <Message> [--action]');
    process.exit(1);
  }

  const ticketId = parseInt(args[0], 10);
  const message = args[1];
  const isAction = args.includes('--action');

  await notify(ticketId, {
    type: isAction ? 'action' : 'notification',
    message
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => {
    console.error('[Notify] Fatal error:', err);
    process.exit(1);
  });
}
