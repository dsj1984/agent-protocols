/**
 * ProgressReporter — emits periodic progress snapshots during a wave.
 *
 * Fires every `intervalSec` (from `orchestration.epicRunner.progressReportIntervalSec`).
 * Each fire:
 *   1. Reads current state of the active wave's stories via `provider.getTicket`.
 *   2. Renders a markdown table: ID | State | Title.
 *   3. Appends a "Notable" section with mechanically-detected signals
 *      (stalled stories, blocked stories, elapsed wave time).
 *   4. Emits the rendered body to the logger AND upserts an `epic-run-progress`
 *      structured comment on the Epic issue so operators watching the ticket
 *      see a single in-place update rather than N comments.
 *
 * Disabled when `intervalSec` is 0, null, or negative.
 *
 * The reporter is tolerant of read failures — a failed provider call logs a
 * warning and skips the fire rather than crashing the runner.
 */

import { upsertStructuredComment } from '../ticketing.js';

export const EPIC_RUN_PROGRESS_TYPE = 'epic-run-progress';

const STATE_EMOJI = {
  done: '✅',
  blocked: '🚧',
  'in-flight': '🔧',
  queued: '⏳',
  unknown: '❓',
};

export class ProgressReporter {
  /**
   * @param {{
   *   provider: import('../../ITicketingProvider.js').ITicketingProvider,
   *   epicId: number,
   *   intervalSec?: number,
   *   logger?: { info?: Function, warn?: Function },
   *   now?: () => Date,
   *   setInterval?: typeof setInterval,
   *   clearInterval?: typeof clearInterval,
   * }} opts
   */
  constructor(opts = {}) {
    const ctx = opts.ctx;
    this.provider = opts.provider ?? ctx?.provider;
    this.epicId = opts.epicId ?? ctx?.epicId;
    if (!this.provider) {
      throw new TypeError('ProgressReporter requires a provider');
    }
    if (!Number.isInteger(this.epicId)) {
      throw new TypeError('ProgressReporter requires a numeric epicId');
    }
    this.intervalSec = Number(opts.intervalSec ?? 0);
    this.logger = opts.logger ?? ctx?.logger ?? console;
    this.now = opts.now ?? (() => new Date());
    this._setInterval = opts.setInterval ?? setInterval;
    this._clearInterval = opts.clearInterval ?? clearInterval;

    this.timer = null;
    this.emitting = false;
    this.currentWave = null; // { index, totalWaves, stories: [...], startedAt }
  }

  /**
   * Returns true when the reporter is configured to emit.
   */
  isEnabled() {
    return Number.isFinite(this.intervalSec) && this.intervalSec > 0;
  }

  /**
   * Update the wave the reporter tracks. Called by the epic-runner each wave.
   *
   * @param {{ index: number, totalWaves: number, stories: Array<number|{id:number}>, startedAt?: string }} wave
   */
  setWave(wave) {
    if (!wave) {
      this.currentWave = null;
      return;
    }
    const stories = (wave.stories ?? []).map((s) =>
      typeof s === 'object' ? (s.id ?? s.storyId) : s,
    );
    this.currentWave = {
      index: wave.index,
      totalWaves: wave.totalWaves,
      stories,
      startedAt: wave.startedAt ?? this.now().toISOString(),
    };
  }

  /**
   * Begin periodic emission. No-op when disabled. Safe to call multiple times.
   */
  start() {
    if (!this.isEnabled() || this.timer) return;
    this.timer = this._setInterval(() => {
      this.fire().catch(() => {});
    }, this.intervalSec * 1000);
    if (this.timer?.unref) this.timer.unref();
  }

  /**
   * Stop periodic emission and emit one final snapshot.
   */
  async stop() {
    if (this.timer) {
      this._clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isEnabled()) {
      await this.fire();
    }
  }

  /**
   * Emit one progress snapshot. Idempotent wrt re-entrancy — concurrent fires
   * drop to a single in-flight emit to avoid comment-upsert thrash.
   */
  async fire() {
    if (this.emitting) return null;
    if (!this.currentWave) return null;
    this.emitting = true;
    try {
      const rows = await Promise.all(
        this.currentWave.stories.map(async (id) => {
          try {
            const ticket = await this.provider.getTicket(id);
            return {
              id,
              state: deriveState(ticket),
              title: truncate(ticket?.title ?? '', 60),
            };
          } catch (err) {
            return {
              id,
              state: 'unknown',
              title: `(read failed: ${err.message})`,
            };
          }
        }),
      );
      const body = this.#render(rows);
      this.logger.info?.(body);
      try {
        await upsertStructuredComment(
          this.provider,
          this.epicId,
          EPIC_RUN_PROGRESS_TYPE,
          body,
        );
      } catch (err) {
        this.logger.warn?.(
          `[ProgressReporter] comment upsert failed: ${err.message}`,
        );
      }
      return { rows, body };
    } finally {
      this.emitting = false;
    }
  }

  #render(rows) {
    const done = rows.filter((r) => r.state === 'done').length;
    const total = rows.length;
    const waveLabel = this.currentWave
      ? `Wave ${this.currentWave.index + 1}/${this.currentWave.totalWaves}`
      : 'Wave ?';
    const elapsed = this.currentWave?.startedAt
      ? ` · ${formatElapsed(this.now() - new Date(this.currentWave.startedAt))} elapsed`
      : '';

    const header = `### 📊 Progress — ${waveLabel} · ${done}/${total} closed${elapsed}`;

    const table = [
      '| ID | State | Title |',
      '|---|---|---|',
      ...rows.map(
        (r) =>
          `| #${r.id} | ${STATE_EMOJI[r.state] ?? ''} ${r.state} | ${escapePipes(r.title)} |`,
      ),
    ].join('\n');

    const notable = this.#renderNotable(rows);
    return [header, '', table, '', '**Notable**', notable].join('\n');
  }

  #renderNotable(rows) {
    const items = [];
    const blocked = rows.filter((r) => r.state === 'blocked');
    if (blocked.length) {
      items.push(
        `- 🚧 ${blocked.length} stor${blocked.length === 1 ? 'y' : 'ies'} blocked: ${blocked.map((r) => `#${r.id}`).join(', ')}`,
      );
    }
    const inFlight = rows.filter((r) => r.state === 'in-flight');
    if (inFlight.length) {
      items.push(
        `- 🔧 ${inFlight.length} in flight: ${inFlight.map((r) => `#${r.id}`).join(', ')}`,
      );
    }
    const unknown = rows.filter((r) => r.state === 'unknown');
    if (unknown.length) {
      items.push(
        `- ❓ ${unknown.length} unreadable (token scope / network?): ${unknown.map((r) => `#${r.id}`).join(', ')}`,
      );
    }
    if (!items.length) items.push('- (none)');
    return items.join('\n');
  }
}

function deriveState(ticket) {
  if (!ticket) return 'unknown';
  const labels = ticket.labels ?? [];
  const state = (ticket.state ?? '').toString().toUpperCase();
  if (state === 'CLOSED' || labels.includes('agent::done')) return 'done';
  if (labels.includes('agent::blocked')) return 'blocked';
  if (labels.includes('agent::executing')) return 'in-flight';
  if (labels.includes('agent::ready')) return 'queued';
  return 'unknown';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function escapePipes(s) {
  return String(s).replace(/\|/g, '\\|');
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
