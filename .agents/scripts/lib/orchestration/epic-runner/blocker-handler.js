/**
 * BlockerHandler — the single runtime pause point for the epic runner.
 *
 * When an executor reports an unresolvable blocker (or the poller observes
 * `agent::blocked` appear on the Epic), the handler:
 *   1. Flips the Epic to `agent::blocked` (authoritative label).
 *   2. Posts a structured friction comment describing the blocker.
 *   3. Fires the notification hook (fire-and-forget).
 *   4. Halts dispatch of the next wave but lets wave-N in-flight stories
 *      finish naturally.
 *   5. Waits for the Epic label to transition back to `agent::executing`
 *      before returning — the orchestrator then resumes.
 *
 * The wait loop polls via the injected `labelFetcher` so tests drive it
 * without real GitHub IO.
 */

const BLOCKED_LABEL = 'agent::blocked';
const EXECUTING_LABEL = 'agent::executing';

export class BlockerHandler {
  /**
   * @param {{
   *   provider: import('../../ITicketingProvider.js').ITicketingProvider,
   *   epicId: number,
   *   notificationHook?: { fire: Function },
   *   labelFetcher?: (id: number) => Promise<string[]>,
   *   pollIntervalMs?: number,
   *   logger?: { info: Function, warn: Function, error: Function },
   *   postComment?: (ticketId: number, payload: object) => Promise<unknown>,
   * }} opts
   */
  constructor({
    provider,
    epicId,
    notificationHook,
    labelFetcher,
    pollIntervalMs,
    logger,
    postComment,
  }) {
    if (!provider) throw new TypeError('BlockerHandler requires a provider');
    this.provider = provider;
    this.epicId = epicId;
    this.notificationHook = notificationHook ?? { fire: async () => {} };
    this.labelFetcher =
      labelFetcher ??
      (async (id) => (await provider.getTicket(id)).labels ?? []);
    this.pollIntervalMs = pollIntervalMs ?? 30_000;
    this.logger = logger ?? console;
    this.postComment =
      postComment ??
      ((ticketId, payload) => provider.postComment(ticketId, payload));
  }

  /**
   * Halt execution and wait for the operator to unblock.
   *
   * @param {{ reason: string, storyId?: number, detail?: string }} info
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ resumed: boolean, reasonToStop?: string }>}
   */
  async halt(info, signal) {
    await this.#markBlocked(info);
    try {
      await this.notificationHook.fire({
        event: 'epic-blocked',
        epicId: this.epicId,
        reason: info.reason,
        storyId: info.storyId,
      });
    } catch (err) {
      this.logger.warn?.(
        `[BlockerHandler] notification hook failed (swallowed): ${err?.message ?? err}`,
      );
    }

    // Wait for operator to flip the label back. The outer orchestrator is
    // responsible for keeping in-flight wave-N stories running while we wait.
    while (!signal?.aborted) {
      const labels = await this.#safeLabels(this.epicId);
      if (labels.includes(EXECUTING_LABEL) && !labels.includes(BLOCKED_LABEL)) {
        this.logger.info?.(
          `[BlockerHandler] Epic #${this.epicId} resumed by operator.`,
        );
        return { resumed: true };
      }
      await this.#sleep(this.pollIntervalMs, signal);
    }
    return { resumed: false, reasonToStop: 'aborted' };
  }

  async #markBlocked({ reason, storyId, detail }) {
    try {
      await this.provider.updateTicket(this.epicId, {
        labels: {
          add: [BLOCKED_LABEL],
          remove: [EXECUTING_LABEL],
        },
      });
    } catch (err) {
      this.logger.warn?.(
        `[BlockerHandler] could not flip Epic label: ${err?.message ?? err}`,
      );
    }

    const body = [
      '### 🚧 Epic blocked',
      `Reason: \`${reason}\``,
      storyId ? `Story: #${storyId}` : null,
      detail ? `\n${detail}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await this.postComment(this.epicId, { type: 'friction', body });
    } catch (err) {
      this.logger.warn?.(
        `[BlockerHandler] friction comment failed: ${err?.message ?? err}`,
      );
    }
  }

  async #safeLabels(id) {
    try {
      return await this.labelFetcher(id);
    } catch (err) {
      this.logger.warn?.(
        `[BlockerHandler] poll error on #${id}: ${err?.message ?? err}`,
      );
      return [];
    }
  }

  #sleep(ms, signal) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref?.();
      signal?.addEventListener?.(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
