/**
 * Cadence decision for `health-monitor.js` (Epic #817 Story #836).
 *
 * `health-monitor.js` previously refreshed Epic tickets + per-task comments at
 * every story-close. For long Epics with many stories per wave that fanout is
 * the dominant cost in the post-merge pipeline. The cadence config exposes
 * four options (see `config-schema.js#HEALTH_REFRESH_SCHEMA`); this module
 * encapsulates the pure decision so it can be unit-tested in isolation.
 *
 * `decideRefresh` is intentionally I/O-free: callers are responsible for
 * loading the persisted state (close count, last refresh timestamp, last
 * refreshed wave) and supplying `now` when behaviour-deterministic timing is
 * needed.
 */

import { DEFAULT_HEALTH_REFRESH } from '../config-schema.js';

/**
 * @typedef {Object} CadenceConfig
 * @property {'every-close'|'every-n-closes'|'wave-boundary'|'min-interval'} cadence
 * @property {number|null} [everyNCloses]
 * @property {number|null} [minIntervalSec]
 */

/**
 * @typedef {Object} CadenceState
 * @property {number} [closeCount]            Number of closes that have already been observed BEFORE this one.
 * @property {number|null} [lastRefreshAt]    Epoch millis of the most recent refresh, or null on the first call.
 * @property {number|null} [currentStoryWave] Wave number of the just-closed story, or null when unknown.
 * @property {number|null} [lastRefreshedWave] Highest wave number we've ever refreshed for.
 */

/**
 * Decide whether a health-monitor refresh should fire for the current close.
 *
 * Defensive defaults: an unrecognised cadence falls back to "always refresh"
 * with an explicit reason, so a misconfigured field never silently suppresses
 * sprint health updates.
 *
 * @param {CadenceConfig|null|undefined} config
 * @param {CadenceState} state
 * @param {number} [now]
 * @returns {{ refresh: boolean, reason: string }}
 */
export function decideRefresh(config, state = {}, now = Date.now()) {
  const cfg = config ?? DEFAULT_HEALTH_REFRESH;
  const cadence = cfg.cadence ?? DEFAULT_HEALTH_REFRESH.cadence;
  const closeCount = Number.isFinite(state.closeCount) ? state.closeCount : 0;

  switch (cadence) {
    case 'every-close':
      return { refresh: true, reason: 'cadence=every-close' };

    case 'every-n-closes': {
      const n = cfg.everyNCloses;
      if (!Number.isInteger(n) || n < 1) {
        return {
          refresh: true,
          reason:
            'cadence=every-n-closes but everyNCloses is missing/invalid; refreshing to fail open',
        };
      }
      // closeCount is the number of CLOSES BEFORE this one. The Nth close
      // (1-indexed) fires when (closeCount + 1) % N === 0.
      const ordinal = closeCount + 1;
      if (ordinal % n === 0) {
        return {
          refresh: true,
          reason: `cadence=every-n-closes — close ${ordinal} hits boundary (n=${n})`,
        };
      }
      return {
        refresh: false,
        reason: `cadence=every-n-closes — close ${ordinal} skipped (next refresh at close ${ordinal + (n - (ordinal % n))})`,
      };
    }

    case 'wave-boundary': {
      const wave = state.currentStoryWave;
      if (!Number.isFinite(wave)) {
        return {
          refresh: true,
          reason:
            'cadence=wave-boundary but current story wave is unknown; refreshing to fail open',
        };
      }
      const lastWave = Number.isFinite(state.lastRefreshedWave)
        ? state.lastRefreshedWave
        : null;
      if (lastWave === null || wave > lastWave) {
        return {
          refresh: true,
          reason: `cadence=wave-boundary — entered wave ${wave} (previously refreshed for wave ${lastWave ?? 'none'})`,
        };
      }
      return {
        refresh: false,
        reason: `cadence=wave-boundary — story sits in wave ${wave}, already refreshed for wave ${lastWave}`,
      };
    }

    case 'min-interval': {
      const sec = cfg.minIntervalSec;
      if (!Number.isInteger(sec) || sec < 1) {
        return {
          refresh: true,
          reason:
            'cadence=min-interval but minIntervalSec is missing/invalid; refreshing to fail open',
        };
      }
      const last = state.lastRefreshAt;
      if (!Number.isFinite(last)) {
        return {
          refresh: true,
          reason: 'cadence=min-interval — first refresh',
        };
      }
      const elapsedSec = Math.floor((now - last) / 1000);
      if (elapsedSec >= sec) {
        return {
          refresh: true,
          reason: `cadence=min-interval — ${elapsedSec}s elapsed (≥ ${sec}s)`,
        };
      }
      return {
        refresh: false,
        reason: `cadence=min-interval — only ${elapsedSec}s elapsed (< ${sec}s)`,
      };
    }

    default:
      return {
        refresh: true,
        reason: `cadence="${cadence}" is unrecognised; refreshing to fail open`,
      };
  }
}
