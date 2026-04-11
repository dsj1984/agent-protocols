/**
 * github-issue-adapter.js — GitHub Issue Auto-Heal Adapter
 *
 * Creates a GitHub Issue populated with the assembled auto-heal prompt. This
 * adapter is the recommended fallback for teams without Jules API access and
 * for red-tier failures where human review is always required.
 *
 * When `adapterConfig.assignCopilot` is `true`, the issue is assigned to
 * `copilot` so that GitHub Copilot can pick it up via its agent mode.
 *
 * Authentication: `GITHUB_TOKEN` environment variable (standard CI secret).
 *
 * @see auto_heal_design.md §GitHub Issue Fallback Adapter
 */

import { IAutoHealAdapter } from './jules-adapter.js';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * @typedef {{
 *   labelPrefix?: string,
 *   assignCopilot?: boolean
 * }} GitHubIssueAdapterConfig
 *
 * @typedef {{
 *   provider?: string,
 *   github?: { owner?: string, repo?: string }
 * }} OrchestrationConfig
 */

/**
 * GitHubIssueAdapter — Creates a GitHub Issue as the auto-heal vehicle.
 *
 * The issue body contains the full assembled prompt so a human or AI agent
 * (Copilot Workspace, Jules, etc.) can act on it from the GitHub UI.
 *
 * @extends {IAutoHealAdapter}
 */
export class GitHubIssueAdapter extends IAutoHealAdapter {
  /**
   * @param {GitHubIssueAdapterConfig} adapterConfig
   *   The `autoHeal.adapters['github-issue']` block from `.agentrc.json`.
   * @param {OrchestrationConfig|null} orchestration
   *   The full `orchestration` config block, needed for `owner`/`repo`.
   */
  constructor(adapterConfig = {}, orchestration = null) {
    super();
    this._config = adapterConfig;
    this._orchestration = orchestration;
    this._labelPrefix = adapterConfig.labelPrefix ?? 'auto-heal';
    this._assignCopilot = adapterConfig.assignCopilot ?? false;
  }

  get adapterId() {
    return 'github-issue';
  }

  /**
   * Create a GitHub Issue representing the auto-heal request.
   *
   * Resolves `owner` and `repo` from the orchestration config. Resolves
   * `GITHUB_TOKEN` from the environment. On auth failure or network error,
   * logs advisory messages and returns an error status — never throws.
   *
   * @param {Parameters<IAutoHealAdapter['dispatch']>[0]} payload
   * @returns {Promise<Awaited<ReturnType<IAutoHealAdapter['dispatch']>>>}
   */
  async dispatch(payload) {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) {
      console.warn(
        `[AutoHeal/GitHubIssue] ⚠️ Missing GITHUB_TOKEN. Set the environment ` +
          `variable "GITHUB_TOKEN" to enable GitHub Issue auto-heal dispatch.`,
      );
      return { status: 'skipped', reason: 'missing-github-token' };
    }

    const owner = this._orchestration?.github?.owner;
    const repo = this._orchestration?.github?.repo;

    if (!owner || !repo) {
      console.warn(
        `[AutoHeal/GitHubIssue] ⚠️ Missing orchestration.github.owner / .repo in ` +
          `.agentrc.json. Cannot create GitHub Issue without repository coordinates.`,
      );
      return {
        status: 'error',
        message: 'orchestration.github.owner and .repo are required',
      };
    }

    const shortSha = String(payload.sha).slice(0, 7);
    const issueTitle = `Auto-Heal: ${payload.riskTier.toUpperCase()} — ${payload.title ?? `CI failure (${shortSha})`}`;

    const assignees = this._assignCopilot ? ['copilot'] : [];
    const labels = [this._labelPrefix];

    const issueBody = this._buildIssueBody(payload);

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels,
          assignees,
        }),
      });
    } catch (networkErr) {
      console.warn(
        `[AutoHeal/GitHubIssue] ⚠️ Network error creating issue: ${networkErr.message}`,
      );
      return {
        status: 'error',
        message: `Network error: ${networkErr.message}`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      console.warn(
        `[AutoHeal/GitHubIssue] ⚠️ Authentication failure (HTTP ${response.status}). ` +
          `Verify that GITHUB_TOKEN has Issues: write permission.`,
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
        // Non-JSON body — issue may still have been created.
      }
      const issueNumber = body.number;
      const issueUrl = body.html_url;
      console.log(
        `[AutoHeal/GitHubIssue] ✅ Issue created: #${issueNumber} — ${issueUrl}`,
      );
      return { status: 'created', issueNumber, issueUrl };
    }

    let errorDetail = '';
    try {
      const errBody = await response.json();
      errorDetail = errBody.message ?? '';
    } catch {
      // ignore
    }

    console.warn(
      `[AutoHeal/GitHubIssue] ⚠️ Unexpected HTTP ${response.status}. ` +
        (errorDetail ? `GitHub says: "${errorDetail}"` : ''),
    );
    return {
      status: 'error',
      message: `HTTP ${response.status} — ${errorDetail || 'unexpected error'}`,
    };
  }

  describe() {
    const owner = this._orchestration?.github?.owner ?? '(unknown)';
    const repo = this._orchestration?.github?.repo ?? '(unknown)';
    return (
      `[GitHubIssueAdapter] adapter=github-issue ` +
      `target=${owner}/${repo} assignCopilot=${this._assignCopilot}`
    );
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Build the GitHub Issue body including the full prompt and meta-header.
   *
   * @param {Parameters<IAutoHealAdapter['dispatch']>[0]} payload
   * @returns {string}
   */
  _buildIssueBody(payload) {
    const shortSha = String(payload.sha).slice(0, 7);
    const prDisplay =
      payload.prNumber && String(payload.prNumber) !== '0'
        ? `#${payload.prNumber}`
        : 'N/A';

    return `> **Auto-generated by [agent-protocols/auto-heal](https://github.com/dsj1984/agent-protocols)**
> Risk Tier: **${payload.riskTier.toUpperCase()}** | Auto-Approve: **${payload.autoApprove ? 'Yes' : 'No'}**
> Commit: \`${shortSha}\` | Branch: \`${payload.branch}\` | PR: ${prDisplay}

---

${payload.prompt}`;
  }
}
