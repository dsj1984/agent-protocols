/**
 * Ticket-Change Notifier — in-band state/label change notifications.
 *
 * Invoked from the orchestration SDK (see ticketing.js:transitionTicketState)
 * so consuming projects get notifications without needing a bespoke GitHub
 * Actions workflow. Three channels, each independently skippable:
 *
 *   1. **log**         — prints a structured line to stderr for local
 *                        operators and CI logs.
 *   2. **epic-comment** — posts a one-line comment on the affected Epic so
 *                        operators have a linear feed of lifecycle events
 *                        on a single issue.
 *   3. **webhook**     — fire-and-forget POST to the configured URL
 *                        (Make.com / Slack / Discord / etc). The URL is read
 *                        from `process.env.NOTIFICATION_WEBHOOK_URL` only —
 *                        sourced from `.env` locally or from the host's
 *                        environment-variables surface in CI / Claude Code
 *                        web. The webhook URL is never read from
 *                        `.agentrc.json`.
 *
 * Level filter (from `orchestration.notifications.level`):
 *
 *   off      — all channels skipped
 *   minimal  — only `state-transition` to `agent::done` / `agent::review`
 *   default  — `state-transition` events for Story and Epic tickets only
 *              (Task-level lifecycle changes are suppressed to reduce noise)
 *   verbose  — all events (default)
 */

import { AGENT_LABELS } from '../label-constants.js';

const DEFAULT_LEVEL = 'verbose';

export function resolveWebhookUrl() {
  return process.env.NOTIFICATION_WEBHOOK_URL?.trim() || null;
}

export class Notifier {
  /**
   * @param {{
   *   config?: { level?: string, postToEpic?: boolean, channels?: string[] },
   *   provider?: { postComment: Function, getTicket: Function },
   *   fetchImpl?: typeof fetch,
   *   logger?: { info: Function, warn: Function, error: Function },
   * }} opts
   */
  constructor({ config, provider, fetchImpl, logger } = {}) {
    this.config = config ?? {};
    this.level = this.config.level ?? DEFAULT_LEVEL;
    this.postToEpic = this.config.postToEpic !== false;
    this.channels = new Set(
      this.config.channels ?? ['log', 'epic-comment', 'webhook'],
    );
    this.provider = provider;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.logger = logger ?? console;
    this.webhookUrl = resolveWebhookUrl();
  }

  /**
   * Fire a notification. Always resolves — errors from individual channels
   * are logged-and-swallowed so notifications never take down the caller.
   *
   * @param {{
   *   kind: 'state-transition' | 'opened' | 'closed' | 'reopened',
   *   ticket: { id: number, title?: string, type?: string, url?: string, epicId?: number|null },
   *   fromState?: string | null,
   *   toState?: string | null,
   *   sender?: string,
   *   metadata?: object,
   * }} event
   *
   * `fromState: null` is a valid value. It signals that the prior state
   * could not be determined — either the ticket had no `agent::*` label
   * before transition, or the snapshot read in `transitionTicketState`
   * failed transiently. Downstream renderers should treat `null` the same
   * as an empty string (the `#buildPayload` branch below already does).
   */
  async emit(event) {
    if (!this.#shouldFire(event)) return { fired: false, reason: 'filtered' };

    const payload = this.#buildPayload(event);
    const results = {};

    if (this.channels.has('log')) {
      results.log = this.#log(payload);
    }
    if (this.channels.has('epic-comment') && this.postToEpic && this.provider) {
      results.epicComment = await this.#postEpicComment(payload);
    }
    if (this.channels.has('webhook') && this.webhookUrl) {
      results.webhook = await this.#postWebhook(payload);
    }

    return { fired: true, results };
  }

  #shouldFire(event) {
    if (this.level === 'off') return false;
    if (this.level === 'verbose') return true;
    if (this.level === 'default') {
      if (event.kind !== 'state-transition') return false;
      const type = event.ticket?.type;
      return type === 'epic' || type === 'story';
    }
    if (this.level === 'minimal') {
      return (
        event.kind === 'state-transition' &&
        (event.toState === AGENT_LABELS.DONE ||
          event.toState === AGENT_LABELS.REVIEW)
      );
    }
    return true;
  }

  #buildPayload(event) {
    const type = event.ticket?.type ?? 'ticket';
    const id = event.ticket?.id;
    const title = event.ticket?.title ?? '';
    const toState = event.toState ?? '';
    const fromState = event.fromState ?? '';

    let summary;
    switch (event.kind) {
      case 'state-transition':
        summary = fromState
          ? `${type} #${id} · \`${fromState}\` → \`${toState}\``
          : `${type} #${id} · → \`${toState}\``;
        break;
      case 'opened':
        summary = `${type} #${id} · 🆕 opened`;
        break;
      case 'closed':
        summary = `${type} #${id} · ✅ closed`;
        break;
      case 'reopened':
        summary = `${type} #${id} · ♻️ reopened`;
        break;
      default:
        summary = `${type} #${id} · ${event.kind}`;
    }
    if (title) summary += ` — ${title.slice(0, 80)}`;

    return {
      kind: event.kind,
      summary,
      ticket: event.ticket,
      fromState,
      toState,
      sender: event.sender ?? 'orchestrator',
      metadata: event.metadata ?? {},
      timestamp: new Date().toISOString(),
    };
  }

  #log(payload) {
    this.logger.info?.(`[notify] ${payload.summary}`);
    return { delivered: true };
  }

  async #postEpicComment(payload) {
    const epicId = payload.ticket?.epicId ?? payload.ticket?.id;
    if (!epicId) return { delivered: false, reason: 'no-epic-id' };
    try {
      await this.provider.postComment(epicId, {
        type: 'progress',
        body: `📋 **State change** · ${payload.summary} _(at ${payload.timestamp})_`,
      });
      return { delivered: true };
    } catch (err) {
      this.logger.warn?.(
        `[notify] epic comment failed: ${err?.message ?? err}`,
      );
      return { delivered: false, reason: err?.message ?? 'error' };
    }
  }

  async #postWebhook(payload) {
    if (!this.fetchImpl || !this.webhookUrl) {
      return { delivered: false, reason: 'no-webhook' };
    }
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: payload.summary }),
      });
      if (!res?.ok) {
        this.logger.warn?.(
          `[notify] webhook returned ${res?.status ?? 'unknown'}`,
        );
        return { delivered: false, reason: `status-${res?.status}` };
      }
      return { delivered: true };
    } catch (err) {
      this.logger.warn?.(`[notify] webhook error: ${err?.message ?? err}`);
      return { delivered: false, reason: 'error' };
    }
  }
}

/**
 * Convenience: build a Notifier from an orchestration config block and a
 * provider. Returns a no-op notifier if notifications are disabled in config.
 *
 * @param {object} orchestration - From `.agentrc.json`
 * @param {object} provider      - ITicketingProvider instance
 * @param {object} [opts]
 */
export function createNotifier(orchestration, provider, opts = {}) {
  const cfg = orchestration?.notifications ?? {};
  return new Notifier({ config: cfg, provider, ...opts });
}
