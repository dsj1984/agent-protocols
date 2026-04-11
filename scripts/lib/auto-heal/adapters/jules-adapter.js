/**
 * jules-adapter.js — Jules API Auto-Heal Adapter
 *
 * Defines the `IAutoHealAdapter` abstract base class (auto-heal adapters are a
 * SEPARATE concern from `IExecutionAdapter` — do NOT mix these hierarchies) and
 * the concrete `JulesAdapter` implementation that dispatches healing sessions
 * to the Jules API v1alpha.
 *
 * Retry policy: 3 attempts with a fixed 2000 ms back-off between each.
 * Rate limits (429): advisory log, return gracefully — never fail CI.
 * Auth failures (401/403): advisory log, return gracefully — never fail CI.
 * All other errors: advisory log, return gracefully — never fail CI.
 *
 * The API key is resolved from the environment variable named in
 * `adapterConfig.apiKeyEnv` (default: `JULES_API_KEY`).
 *
 * @see auto_heal_design.md §Jules API Adapter
 */

// ── Abstract Base ─────────────────────────────────────────────────────────────

/**
 * IAutoHealAdapter — Abstract Auto-Heal Adapter Interface
 *
 * Separates "what to heal" (CLI / risk resolver) from "how to dispatch" (adapter).
 * All concrete auto-heal adapters extend this class and override every method.
 *
 * This is deliberately a SEPARATE interface from IExecutionAdapter.
 * Auto-heal and sprint-dispatch are different concerns with different payloads.
 */
export class IAutoHealAdapter {
  /**
   * The adapter identifier string (e.g., `'jules'`, `'github-issue'`).
   * @type {string}
   */
  get adapterId() {
    throw new Error('Not implemented: adapterId getter');
  }

  /**
   * Dispatch an auto-heal session for a set of CI failures.
   *
   * @param {{
   *   prompt: string,
   *   repo: string,
   *   branch: string,
   *   sha: string,
   *   title: string,
   *   riskTier: import('../risk-resolver.js').RiskTier,
   *   autoApprove: boolean,
   *   requirePlanApproval: boolean
   * }} payload - The assembled healing payload.
   * @returns {Promise<{
   *   status: 'created'|'rate-limited'|'auth-failed'|'error'|'skipped',
   *   sessionId?: string,
   *   sessionName?: string,
   *   issueNumber?: number,
   *   issueUrl?: string,
   *   message?: string
   * }>}
   */
  async dispatch(_payload) {
    throw new Error('Not implemented: dispatch');
  }

  /**
   * Return a human-readable description of this adapter for logging.
   * @returns {string}
   */
  describe() {
    return `[IAutoHealAdapter] adapter=${this.adapterId}`;
  }
}

// ── Jules Adapter ─────────────────────────────────────────────────────────────

const DEFAULT_API_URL = 'https://jules.googleapis.com/v1alpha/sessions';
const DEFAULT_API_KEY_ENV = 'JULES_API_KEY';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

/**
 * @typedef {{
 *   apiKeyEnv?: string,
 *   apiUrl?: string,
 *   requirePlanApproval?: boolean,
 *   maxRetries?: number,
 *   timeoutMs?: number
 * }} JulesAdapterConfig
 */

/**
 * JulesAdapter — Primary auto-heal adapter targeting the Jules API v1alpha.
 *
 * Resolves the API key from the environment, builds the API payload,
 * and dispatches with retry logic. All network errors are advisory — the
 * adapter never throws to the caller.
 *
 * @extends {IAutoHealAdapter}
 */
export class JulesAdapter extends IAutoHealAdapter {
  /**
   * @param {JulesAdapterConfig} adapterConfig
   *   The `autoHeal.adapters.jules` block from `.agentrc.json`.
   */
  constructor(adapterConfig = {}) {
    super();
    /** @type {JulesAdapterConfig} */
    this._config = adapterConfig;
    this._apiKeyEnv = adapterConfig.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
    this._apiUrl = adapterConfig.apiUrl ?? DEFAULT_API_URL;
    this._requirePlanApproval = adapterConfig.requirePlanApproval ?? true;
    this._maxRetries = adapterConfig.maxRetries ?? DEFAULT_MAX_RETRIES;
    this._timeoutMs = adapterConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get adapterId() {
    return 'jules';
  }

  /**
   * Dispatch a healing session to the Jules API.
   *
   * Validates the API key, builds the payload, and calls `fetch()` with retry.
   * Every non-success outcome is logged as advisory and returns a structured
   * result object — the function itself never rejects.
   *
   * @param {Parameters<IAutoHealAdapter['dispatch']>[0]} payload
   * @returns {Promise<Awaited<ReturnType<IAutoHealAdapter['dispatch']>>>}
   */
  async dispatch(payload) {
    const apiKey = process.env[this._apiKeyEnv];

    if (!apiKey) {
      console.warn(
        `[AutoHeal/Jules] ⚠️ Missing API key. Set the environment variable ` +
          `"${this._apiKeyEnv}" to enable Jules auto-heal sessions.\n` +
          `  Setup guide: https://jules.google.com/docs/api-access`,
      );
      return { status: 'skipped', reason: 'missing-api-key' };
    }

    const julesPayload = this._buildPayload(payload);

    for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
      let response;
      try {
        response = await this._fetchWithTimeout(
          this._apiUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(julesPayload),
          },
          this._timeoutMs,
        );
      } catch (networkErr) {
        const isLastAttempt = attempt === this._maxRetries;
        console.warn(
          `[AutoHeal/Jules] ⚠️ Network error (attempt ${attempt}/${this._maxRetries}): ${networkErr.message}`,
        );
        if (!isLastAttempt) {
          await this._sleep(RETRY_DELAY_MS);
          continue;
        }
        return {
          status: 'error',
          message: `Network error after ${this._maxRetries} attempts: ${networkErr.message}`,
        };
      }

      // ── Response handling ──────────────────────────────────────────────────

      if (response.status === 429) {
        console.warn(
          `[AutoHeal/Jules] ⚠️ Rate limited (HTTP 429). Jules session not dispatched ` +
            `this run — will retry on next CI trigger.`,
        );
        return {
          status: 'rate-limited',
          message: 'Rate limit reached (HTTP 429)',
        };
      }

      if (response.status === 401 || response.status === 403) {
        console.warn(
          `[AutoHeal/Jules] ⚠️ Authentication failure (HTTP ${response.status}). ` +
            `Check that "${this._apiKeyEnv}" is valid and has not expired.`,
        );
        return {
          status: 'auth-failed',
          message: `HTTP ${response.status} — authentication failure`,
        };
      }

      if (response.status >= 200 && response.status < 300) {
        let body = {};
        try {
          body = await response.json();
        } catch {
          // Non-JSON success body — session may still have been created.
        }
        const sessionId = body.sessionId ?? body.name ?? null;
        const sessionName = body.displayName ?? body.title ?? payload.title;
        console.log(
          `[AutoHeal/Jules] ✅ Session created: ${sessionId ?? '(id unknown)'}`,
        );
        return { status: 'created', sessionId, sessionName };
      }

      // Unexpected HTTP status — log and retry if attempts remain.
      const isLastAttempt = attempt === this._maxRetries;
      const statusText = response.statusText ?? '';
      console.warn(
        `[AutoHeal/Jules] ⚠️ Unexpected HTTP ${response.status} ${statusText} ` +
          `(attempt ${attempt}/${this._maxRetries}).`,
      );
      if (!isLastAttempt) {
        await this._sleep(RETRY_DELAY_MS);
      } else {
        return {
          status: 'error',
          message: `Unexpected HTTP ${response.status} after ${this._maxRetries} attempts`,
        };
      }
    }

    // Should be unreachable — the loop always returns on last attempt.
    return { status: 'error', message: 'Exhausted all retry attempts' };
  }

  describe() {
    return `[JulesAdapter] adapter=jules url=${this._apiUrl} retries=${this._maxRetries}`;
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Build the Jules API v1alpha request body.
   *
   * @param {Parameters<IAutoHealAdapter['dispatch']>[0]} payload
   * @returns {object}
   */
  _buildPayload(payload) {
    return {
      displayName: payload.title,
      sourceContext: {
        repository: payload.repo,
        branch: payload.branch,
        commitSha: payload.sha,
      },
      prompt: payload.prompt,
      automationMode: payload.autoApprove ? 'AUTO' : 'SUPERVISED',
      requirePlanApproval:
        payload.requirePlanApproval ?? this._requirePlanApproval,
      metadata: {
        riskTier: payload.riskTier,
        generatedBy: 'agent-protocols/auto-heal',
      },
    };
  }

  /**
   * `fetch()` wrapper that rejects on timeout via an AbortController signal.
   *
   * @param {string} url
   * @param {RequestInit} init
   * @param {number} timeoutMs
   * @returns {Promise<Response>}
   */
  async _fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Async sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
