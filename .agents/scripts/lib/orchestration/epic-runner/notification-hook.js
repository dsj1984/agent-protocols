/**
 * NotificationHook — fire-and-forget webhook POSTs for orchestrator events.
 *
 * Contract:
 *   - Never blocks execution on webhook I/O beyond the caller's `await`.
 *   - Webhook failures are logged and swallowed — they never bubble into the
 *     orchestrator flow.
 *   - When no webhook URL resolves, `fire()` is a no-op that resolves
 *     immediately with `{ delivered: false, reason: 'no-url' }`.
 *   - URL resolution follows the shared `resolveWebhookUrl` contract:
 *     env `NOTIFICATION_WEBHOOK_URL` → `.mcp.json` agent-protocols server env.
 *     Callers may pass an explicit `webhookUrl` to bypass resolution (used by
 *     tests).
 */

import { createHmac } from 'node:crypto';

import { resolveWebhookUrl } from '../../notifications/notifier.js';

export class NotificationHook {
  /**
   * @param {{
   *   webhookUrl?: string | null,
   *   secret?: string | null,
   *   fetchImpl?: typeof fetch,
   *   logger?: { warn: Function, error: Function },
   *   timeoutMs?: number,
   *   cwd?: string,
   * }} opts
   */
  constructor(opts = {}) {
    // `webhookUrl === undefined` → resolve from env/.mcp.json.
    // `webhookUrl === null | string` → caller was explicit; don't resolve.
    this.webhookUrl =
      opts.webhookUrl === undefined
        ? resolveWebhookUrl({ cwd: opts.cwd })
        : opts.webhookUrl;
    this.secret = opts.secret ?? null;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.logger = opts.logger ?? console;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  /**
   * Fire a payload. Always resolves — never rejects.
   *
   * @param {{ event: string, [k: string]: unknown }} payload
   */
  async fire(payload) {
    if (!this.webhookUrl) {
      return { delivered: false, reason: 'no-url' };
    }
    if (typeof this.fetchImpl !== 'function') {
      return { delivered: false, reason: 'no-fetch' };
    }

    const body = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
    });
    const headers = { 'content-type': 'application/json' };
    if (this.secret) {
      const signature = createHmac('sha256', this.secret)
        .update(body)
        .digest('hex');
      headers['x-webhook-signature'] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (!res?.ok) {
        this.logger.warn?.(
          `[NotificationHook] webhook returned ${res?.status ?? 'unknown'}`,
        );
        return { delivered: false, reason: `status-${res?.status}` };
      }
      return { delivered: true };
    } catch (err) {
      this.logger.warn?.(
        `[NotificationHook] webhook error: ${err?.message ?? err}`,
      );
      return { delivered: false, reason: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
