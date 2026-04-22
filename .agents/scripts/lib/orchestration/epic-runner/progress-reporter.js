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
 *   5. When `logFile` is set, also appends the rendered snapshot (with an
 *      ISO-timestamped divider) to that path. This lets the /sprint-execute
 *      skill tail the file via `Monitor` to stream progress into IDE chat even
 *      when the runner itself is invoked in a background Bash that doesn't
 *      surface stdout live.
 *
 * Disabled when `intervalSec` is 0, null, or negative.
 *
 * The reporter is tolerant of read failures — a failed provider call logs a
 * warning and skips the fire rather than crashing the runner.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AGENT_LABELS } from '../../label-constants.js';
import { upsertStructuredComment } from '../ticketing.js';
import { createStalledWorktreeDetector } from './progress-signals/stalled-worktree.js';

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
   *   logFile?: string | null,
   *   appendFile?: typeof import('node:fs/promises').appendFile,
   *   mkdir?: typeof import('node:fs/promises').mkdir,
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

    this.detectors = Array.isArray(opts.detectors)
      ? opts.detectors.filter(Boolean)
      : [createStalledWorktreeDetector({ cwd: ctx?.cwd })];

    // Optional friction emitter for auto-posting structured comments onto
    // affected Story tickets when the poller's per-Story `getTicket` read
    // fails. Undefined in legacy callers — those paths keep the prior silent
    // behavior (warn-log-only) until the coordinator wires an emitter in.
    this.frictionEmitter = opts.frictionEmitter ?? ctx?.frictionEmitter ?? null;

    // Optional file sink — when set, every rendered snapshot is appended to
    // this path prefixed by an ISO-timestamped divider. Enables operators
    // (or the /sprint-execute skill) to tail progress in real time even when
    // the runner's stdout is swallowed by a background Bash invocation.
    // Tests omit `logFile` to keep the filesystem clean.
    this.logFile = opts.logFile ?? null;
    this._appendFile = opts.appendFile ?? appendFile;
    this._mkdir = opts.mkdir ?? mkdir;
    this.logFileReady = false;

    this.timer = null;
    this.emitting = false;
    this.currentWave = null; // { index, totalWaves, stories: [...], startedAt }
    // Full plan: ordered list of waves, each `{ index, stories: [storyId,...] }`.
    // Set once via `setPlan()` at runner start so each fire renders every wave
    // (queued / in-flight / done) rather than only the active one.
    this.plan = null;
    this.epicStartedAt = null;
  }

  /**
   * Provide the full wave plan once at runner start so subsequent fires can
   * render every wave (not just the active one). `waves` is the same shape
   * `WaveScheduler` consumes — an array of arrays of story objects (or ids).
   *
   * @param {{ waves: Array<Array<number|{id?:number,number?:number,storyId?:number,title?:string}>>, startedAt?: string }} plan
   */
  setPlan(plan) {
    if (!plan || !Array.isArray(plan.waves)) {
      this.plan = null;
      return;
    }
    this.plan = plan.waves.map((stories, index) => ({
      index,
      stories: (stories ?? []).map((s) => {
        if (typeof s === 'object' && s !== null) {
          const id = s.id ?? s.number ?? s.storyId;
          return { id: Number(id), title: s.title ?? '' };
        }
        return { id: Number(s), title: '' };
      }),
    }));
    this.epicStartedAt = plan.startedAt ?? this.now().toISOString();
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
    if (this.logFile && this.currentWave) {
      const waveNum = (this.currentWave.index ?? 0) + 1;
      const totalWaves =
        this.currentWave.totalWaves ?? this.plan?.length ?? '?';
      this.#appendToLogFile(
        `### ⏱ ${this.now().toISOString()} — Wave ${waveNum}/${totalWaves} starting\n\n`,
      ).catch((err) => {
        this.logger.warn?.(
          `[ProgressReporter] log header write failed: ${err.message}`,
        );
      });
    }
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
    if (!this.currentWave && !this.plan) return null;
    this.emitting = true;
    try {
      // When a plan is set, fetch state for every story in every wave so the
      // table covers the whole epic. Otherwise fall back to the current wave
      // only (back-compat: callers that haven't migrated to setPlan).
      const allIds = this.plan
        ? this.plan.flatMap((w) => w.stories.map((s) => s.id))
        : (this.currentWave?.stories ?? []);
      const fetched = await Promise.all(
        allIds.map(async (id) => {
          try {
            const ticket = await this.provider.getTicket(id);
            return [
              id,
              {
                state: deriveState(ticket),
                title: truncate(ticket?.title ?? '', 60),
              },
            ];
          } catch (err) {
            // Preserve the post-#448 fail-loud contract: the error must still
            // propagate so a persistent GraphQL-read regression halts the
            // wave instead of rendering unreadable rows forever. But emit a
            // rate-limited `friction` comment onto the affected Story first
            // so the operator sees the failure directly on the ticket rather
            // than only in CI logs.
            await this.#emitFetchFailureFriction(id, err);
            throw err;
          }
        }),
      );
      const byId = new Map(fetched);
      const rows = this.plan
        ? this.plan.flatMap((w) =>
            w.stories.map((s) => ({
              wave: w.index,
              id: s.id,
              ...byId.get(s.id),
              title: byId.get(s.id)?.title || s.title || '',
            })),
          )
        : (this.currentWave?.stories ?? []).map((id) => ({
            id,
            ...byId.get(id),
          }));
      const body = await this.#render(rows);
      this.logger.info?.(body);
      if (this.logFile) {
        try {
          await this.#appendToLogFile(
            `### ⏱ ${this.now().toISOString()}\n\n${body}\n\n---\n\n`,
          );
        } catch (err) {
          this.logger.warn?.(
            `[ProgressReporter] log file append failed: ${err.message}`,
          );
        }
      }
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

  async #appendToLogFile(chunk) {
    if (!this.logFile) return;
    if (!this.logFileReady) {
      await this._mkdir(dirname(this.logFile), { recursive: true });
      this.logFileReady = true;
    }
    await this._appendFile(this.logFile, chunk, 'utf8');
  }

  async #emitFetchFailureFriction(storyId, err) {
    if (!this.frictionEmitter) return;
    const body = [
      `### 🚧 Friction — poller getTicket failed`,
      '',
      `- Story: \`#${storyId}\``,
      `- Epic: \`#${this.epicId}\``,
      `- Error: \`${String(err?.message ?? err).slice(0, 500)}\``,
      '',
      "The epic runner failed to read this Story's labels during its wave",
      'progress poll. If this is the GraphQL `variableNotUsed: $issueId` class',
      'of failure the Story will render as `unknown` in the progress table and',
      'the poller will retry next tick.',
    ].join('\n');
    try {
      await this.frictionEmitter.emit({
        ticketId: Number(storyId),
        markerKey: 'poller-fetch-failure',
        body,
      });
    } catch (emitErr) {
      this.logger.warn?.(
        `[ProgressReporter] friction emit failed for #${storyId}: ${emitErr?.message ?? emitErr}`,
      );
    }
  }

  async #render(rows) {
    const done = rows.filter((r) => r.state === 'done').length;
    const total = rows.length;
    const totalWaves = this.plan?.length ?? this.currentWave?.totalWaves ?? '?';
    const currentWaveNum = this.currentWave
      ? this.currentWave.index + 1
      : (this.plan?.length ?? '?');
    const waveLabel = `Wave ${currentWaveNum}/${totalWaves}`;
    const elapsedSrc =
      this.epicStartedAt ?? this.currentWave?.startedAt ?? null;
    const elapsed = elapsedSrc
      ? ` · ${formatElapsed(this.now() - new Date(elapsedSrc))} elapsed`
      : '';

    const header = `### 📊 Progress — ${waveLabel} · ${done}/${total} closed${elapsed}`;

    const includeWaveCol = rows.some((r) => Number.isInteger(r.wave));
    const table = includeWaveCol
      ? [
          '| Wave | ID | State | Title |',
          '|---|---|---|---|',
          ...rows.map(
            (r) =>
              `| ${r.wave + 1} | #${r.id} | ${STATE_EMOJI[r.state] ?? ''} ${r.state} | ${escapePipes(r.title)} |`,
          ),
        ].join('\n')
      : [
          '| ID | State | Title |',
          '|---|---|---|',
          ...rows.map(
            (r) =>
              `| #${r.id} | ${STATE_EMOJI[r.state] ?? ''} ${r.state} | ${escapePipes(r.title)} |`,
          ),
        ].join('\n');

    const notable = await this.#renderNotable(rows);
    return [header, '', table, '', '**Notable**', notable].join('\n');
  }

  async #renderNotable(rows) {
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
    const ctx = { wave: this.currentWave };
    const detectorResults = await Promise.all(
      this.detectors.map(async (detector) => {
        try {
          const fn =
            typeof detector === 'function' ? detector : detector?.detect;
          if (typeof fn !== 'function') return [];
          const out = await fn.call(detector, rows, ctx);
          return Array.isArray(out) ? out : [];
        } catch (err) {
          this.logger.warn?.(
            `[ProgressReporter] detector failed: ${err.message}`,
          );
          return [];
        }
      }),
    );
    for (const bullets of detectorResults) {
      for (const b of bullets) items.push(b.startsWith('- ') ? b : `- ${b}`);
    }

    if (!items.length) items.push('- (none)');
    return items.join('\n');
  }
}

function deriveState(ticket) {
  if (!ticket) return 'unknown';
  const labels = ticket.labels ?? [];
  const state = (ticket.state ?? '').toString().toUpperCase();
  if (state === 'CLOSED' || labels.includes(AGENT_LABELS.DONE)) return 'done';
  if (labels.includes(AGENT_LABELS.BLOCKED)) return 'blocked';
  if (labels.includes(AGENT_LABELS.EXECUTING)) return 'in-flight';
  if (labels.includes(AGENT_LABELS.READY)) return 'queued';
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
