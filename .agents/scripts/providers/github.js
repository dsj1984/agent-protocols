/**
 * GitHub Provider — Concrete ITicketingProvider Implementation
 *
 * Implements all 10 interface methods using raw `fetch()` (Node 20+).
 * No @octokit/* dependency — aligns with the "Self-Contained Architecture"
 * guiding principle.
 *
 * Authentication resolution:
 *   1. GITHUB_TOKEN environment variable
 *   2. `gh auth token` CLI fallback
 *   3. Throws with clear error message
 *
 * API Strategy:
 *   - REST for Issues, Labels, Pull Requests
 *   - GraphQL for Projects V2 (custom fields)
 *
 * @see docs/v5-implementation-plan.md Sprint 1B
 */

import { execSync } from 'node:child_process';
import { parseBlockedBy, parseBlocks } from '../lib/dependency-parser.js';
import { ITicketingProvider } from '../lib/ITicketingProvider.js';
import { parseLinkedIssues } from '../lib/issue-link-parser.js';
import { classifyGithubError } from './github/error-classifier.js';
import { GithubHttpClient } from './github-http-client.js';

/**
 * Resolve the GitHub token from environment or CLI.
 *
 * Hierarchy:
 *   1. Explicit GITHUB_TOKEN or GH_TOKEN env var (CI/CD / Manual)
 *   2. `gh auth token` CLI (Local development)
 *
 * NOTE: When running via an AI Agent (Antigravity), the GitHub MCP Server
 * should be used primarily by the agent itself. This Resolve function is
 * for the background Node.js scripts that cannot natively call MCP tools.
 *
 * @returns {string} The GitHub personal access token.
 * @throws {Error} If no token can be resolved.
 */
/* node:coverage ignore next */
function resolveToken() {
  // 1. Environment variables
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) return token;

  // 2. GitHub CLI fallback
  try {
    const ghToken = execSync('gh auth token', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (ghToken) return ghToken;
  } catch {
    // gh CLI not installed or not authenticated
  }

  // 3. Robust Error Reporting
  const errorMsg = [
    '[GitHubProvider] Authentication Failed: No GitHub token found.',
    '',
    'To resolve this, choose one of the following:',
    '  A. (CI/CD / Agent Script) Set the GITHUB_TOKEN or GH_TOKEN environment variable.',
    '  B. (Local) Run `gh auth login` to authenticate the GitHub CLI.',
    '',
    'See .agents/README.md#authentication for details.',
  ].join('\n');

  throw new Error(errorMsg);
}

// parseBlockedBy and parseBlocks are now imported from lib/dependency-parser.js (M-1).

export class GitHubProvider extends ITicketingProvider {
  /**
   * @param {{ owner: string, repo: string, projectNumber?: number|null, operatorHandle?: string }} config
   * @param {{ token?: string }} [opts] - Override token for testing.
   */
  constructor(config, opts = {}) {
    super();
    this.owner = config.owner;
    this.repo = config.repo;
    this.projectNumber = config.projectNumber ?? null;
    this.projectOwner = config.projectOwner ?? config.owner;
    this.projectName = config.projectName ?? null;
    this.operatorHandle = config.operatorHandle ?? null;
    // Injectable HTTP transport. The tokenProvider closure captures opts.token
    // so tests can construct with an explicit token without touching env/gh.
    this._http =
      opts.http ??
      new GithubHttpClient({
        tokenProvider: () => opts.token ?? resolveToken(),
        fetchImpl: opts.fetchImpl,
      });

    // Per-instance memoization for `getTicket`. Scoped to the lifetime of
    // this provider instance (one dispatcher/close-out run), so a ticket
    // fetched by the dispatcher, reconciler, and cascade all share the
    // same network round-trip. `updateTicket` / `postComment` on a given
    // ticketId invalidate that ticket's entry. List endpoints
    // (`getTickets`, `getSubTickets`) deliberately do NOT populate this
    // cache — they page through many issues where staleness is a concern.
    this._ticketCache = new Map();
  }

  /** Lazily resolve the token on first API call. */
  get token() {
    return this._http.token;
  }

  // `graphql` is part of the public ITicketingProvider interface and must
  // therefore live on the instance. The other HTTP calls delegate directly
  // to `this._http.*` without wrapper methods (see 5.12.3 refactor).
  async graphql(query, variables = {}, opts = {}) {
    return this._http.graphql(query, variables, opts);
  }

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  /**
   * Internal helper to fetch and map Epics.
   * @param {{ state?: 'open'|'closed'|'all' }} filters
   * @returns {Promise<Array>}
   * @private
   */
  async _getEpics(filters = {}) {
    const params = new URLSearchParams({
      state: filters.state ?? 'all',
      labels: 'type::epic',
    });

    const issues = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );

    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => {
        const labels = (issue.labels ?? []).map((l) =>
          typeof l === 'string' ? l : l.name,
        );
        return {
          id: issue.number,
          title: issue.title,
          labels,
          labelSet: new Set(labels),
          state: issue.state,
          state_reason: issue.state_reason,
        };
      });
  }

  /* node:coverage ignore next */
  async listIssues(filters = {}) {
    return this._getEpics(filters);
  }

  /* node:coverage ignore next */
  async getEpics(filters = {}) {
    return this._getEpics(filters);
  }

  async getEpic(epicId) {
    const issue = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/${epicId}`,
    );

    const labels = (issue.labels ?? []).map((l) =>
      typeof l === 'string' ? l : l.name,
    );

    return {
      id: issue.number,
      internalId: issue.id,
      nodeId: issue.node_id,
      title: issue.title,
      body: issue.body ?? '',
      labels,
      labelSet: new Set(labels),
      linkedIssues: parseLinkedIssues(issue.body),
    };
  }

  /* node:coverage ignore next */
  async getTickets(epicId, filters = {}) {
    // Paginate through all issues to avoid silent data loss (C-1).
    const params = new URLSearchParams({
      state: filters.state ?? 'all',
    });
    if (filters.label) {
      params.set('labels', filters.label);
    }

    const issues = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );

    // Use word-boundary regex to prevent #1 matching #10, #100, etc. (C-2).
    const epicRefRe = new RegExp(
      `(?:Epic:\\s*#${epicId}|parent:\\s*#${epicId})(?:\\s|$|[,.)\\]])`,
    );

    // Filter to only issues that reference the epic
    return issues
      .filter((issue) => {
        if (issue.pull_request) return false; // Skip PRs
        const body = issue.body ?? '';
        return epicRefRe.test(body);
      })
      .map((issue) => {
        const labels = (issue.labels ?? []).map((l) =>
          typeof l === 'string' ? l : l.name,
        );
        return {
          id: issue.number,
          internalId: issue.id,
          nodeId: issue.node_id,
          title: issue.title,
          body: issue.body ?? '',
          labels,
          labelSet: new Set(labels),
          state: issue.state,
        };
      });
  }

  async getSubTickets(parentId) {
    const parent = await this.getTicket(parentId);
    const body = parent.body || '';

    // Primary: Native GitHub Sub-Issues (v5 source of truth). The query
    // pulls every field shared with `getTicket`'s return shape so each sub
    // issue can seed `_ticketCache` in a single round-trip, eliminating
    // the N+1 REST fan-out that followed this call previously. Cursor
    // pagination prevents silent truncation on Epics with >50 children.
    const nativeChildIds = [];
    try {
      let cursor = null;
      while (true) {
        const data = await this._http.graphql(
          `query($id: ID!, $cursor: String) {
            node(id: $id) {
              ... on Issue {
                subIssues(first: 50, after: $cursor) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    number
                    databaseId
                    id
                    title
                    body
                    state
                    labels(first: 30) { nodes { name } }
                    assignees(first: 20) { nodes { login } }
                  }
                }
              }
            }
          }`,
          { id: parent.nodeId, cursor },
          { headers: { 'GraphQL-Features': 'sub_issues' } },
        );

        const page = data.node?.subIssues;
        const nodes = page?.nodes ?? [];
        for (const node of nodes) {
          nativeChildIds.push(node.number);
          // Only seed the cache on a miss — an existing entry may be
          // newer (e.g. refreshed after a mutation invalidated it).
          if (!this._ticketCache.has(node.number)) {
            this._ticketCache.set(
              node.number,
              this._subIssueNodeToTicket(node),
            );
          }
        }

        if (!page?.pageInfo?.hasNextPage) break;
        cursor = page.pageInfo.endCursor;
      }
    } catch (err) {
      const category = classifyGithubError(err);
      if (category === 'feature-disabled') {
        // Sub-issues GraphQL not available on this repo/org — fall back to
        // checklist scraping silently. This is the expected path on repos
        // without the sub-issues feature.
        console.warn(
          `[GitHubProvider] sub-issues GraphQL unavailable (parent #${parentId}); using checklist fallback`,
        );
      } else {
        console.error(
          `[GitHubProvider] sub-issues GraphQL failed (parent #${parentId}, category=${category}): ${err.message}`,
        );
        throw err;
      }
    }

    // Secondary: Match checklist items linking to issues: "- [ ] #123" or "- [x] #123"
    const re = /-\s*\[[ xX]\]\s+#(\d+)/g;
    const checklistChildIds = [...body.matchAll(re)].map((m) =>
      Number.parseInt(m[1], 10),
    );

    // Tertiary: Reverse-search for issues pointing to this parent in their body (C-5 fallback).
    // Guard: only run for Epic-type parents to avoid full-repo scans on Story/Feature parents,
    // which would incorrectly pull in sibling tickets and waste API quota.
    let referencedChildIds = [];
    const isEpicParent = (parent.labels ?? []).includes('type::epic');
    if (isEpicParent) {
      try {
        const issues = await this.getTickets(parentId);
        referencedChildIds = issues.map((i) => i.id);
      } catch (err) {
        // Tertiary reverse-lookup failed; non-fatal — continue with native + checklist sources.
        console.warn(
          `[GitHubProvider] reverse dependency lookup (parent #${parentId}): ${err.message}`,
        );
      }
    }

    // Merge and remove duplicates
    const allChildIds = [
      ...new Set([
        ...nativeChildIds,
        ...checklistChildIds,
        ...referencedChildIds,
      ]),
    ];

    // Fetch all child tickets
    const subTickets = await Promise.all(
      allChildIds.map((id) => this.getTicket(id).catch(() => null)),
    );

    return subTickets.filter(Boolean);
  }

  async getTicket(ticketId) {
    if (this._ticketCache.has(ticketId)) {
      return this._ticketCache.get(ticketId);
    }

    const issue = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/${ticketId}`,
    );

    const labels = (issue.labels ?? []).map((l) =>
      typeof l === 'string' ? l : l.name,
    );

    const ticket = {
      id: issue.number,
      internalId: issue.id,
      nodeId: issue.node_id,
      title: issue.title,
      body: issue.body ?? '',
      labels,
      labelSet: new Set(labels),
      assignees: (issue.assignees ?? []).map((a) => a.login),
      state: issue.state,
    };

    this._ticketCache.set(ticketId, ticket);
    return ticket;
  }

  /**
   * Map a GraphQL sub-issue node into the ticket shape that
   * `getTicket`/`getTickets` return. Keeps the state label lower-cased to
   * match the REST API (`open`/`closed`) so downstream code never has to
   * case-normalise at the call site.
   * @private
   */
  _subIssueNodeToTicket(node) {
    const labels = (node.labels?.nodes ?? []).map((l) => l.name);
    return {
      id: node.number,
      internalId: node.databaseId,
      nodeId: node.id,
      title: node.title,
      body: node.body ?? '',
      labels,
      labelSet: new Set(labels),
      assignees: (node.assignees?.nodes ?? []).map((a) => a.login),
      state:
        typeof node.state === 'string' ? node.state.toLowerCase() : node.state,
    };
  }

  /**
   * Seed the per-instance getTicket cache with tickets already hydrated by
   * callers (e.g. from a single `getTickets(epicId)` sweep). Only fields
   * shared with `getTicket`'s return shape need be present.
   */
  primeTicketCache(tickets) {
    for (const t of tickets ?? []) {
      if (t && typeof t.id === 'number') {
        if (!t.labelSet && Array.isArray(t.labels)) {
          t.labelSet = new Set(t.labels);
        }
        this._ticketCache.set(t.id, t);
      }
    }
  }

  /** Drop a specific ticket from the cache. Called after any mutation. */
  invalidateTicket(ticketId) {
    this._ticketCache.delete(ticketId);
  }

  /* node:coverage ignore next */
  async getTicketDependencies(ticketId) {
    const ticket = await this.getTicket(ticketId);
    return {
      blocks: parseBlocks(ticket.body),
      blockedBy: parseBlockedBy(ticket.body),
    };
  }

  async getRecentComments(limit = 100) {
    const comments = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/comments?sort=created&direction=desc&per_page=${limit}`,
    );
    return comments || [];
  }

  async getTicketComments(ticketId) {
    const comments = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/issues/${ticketId}/comments`,
    );
    return comments || [];
  }

  // ---------------------------------------------------------------------------
  // Write Operations
  // ---------------------------------------------------------------------------

  /* node:coverage ignore next */
  async createTicket(parentId, ticketData) {
    const epicId = ticketData.epicId || parentId;
    const bodyParts = [
      ticketData.body || '',
      '',
      `---`,
      `parent: #${parentId}`,
    ];

    if (epicId !== parentId) {
      bodyParts.push(`Epic: #${epicId}`);
    }

    // Add dependency references
    if (ticketData.dependencies?.length) {
      bodyParts.push('');
      for (const dep of ticketData.dependencies) {
        bodyParts.push(`blocked by #${dep}`);
      }
    }

    const issue = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues`,
      {
        method: 'POST',
        body: {
          title: ticketData.title,
          body: bodyParts.join('\n'),
          labels: ticketData.labels ?? [],
        },
      },
    );

    // Natively link as sub-issue
    try {
      await this.addSubIssue(parentId, issue.node_id);
    } catch (err) {
      // Sub-issues might not be enabled or permission issues — fallback to text-only link (already in body)
      console.warn(
        `[GitHubProvider] sub-issue link failed for #${issue.number} → parent #${parentId}: ${err.message}`,
      );
    }

    // Add to project if configured
    try {
      if (this.projectNumber) {
        await this._addItemToProject(issue.node_id);
      }
    } catch (err) {
      console.warn(
        `[GitHubProvider] Failed to add Issue #${issue.number} to project: ${err.message}`,
      );
    }

    return {
      id: issue.number,
      internalId: issue.id,
      nodeId: issue.node_id,
      url: issue.html_url,
    };
  }

  async addSubIssue(
    parentNumber,
    childNodeId,
    opts = { replaceParent: false },
  ) {
    const parentTicket = await this.getTicket(parentNumber);

    return this._http.graphql(
      `
      mutation($parentId: ID!, $subIssueId: ID!, $replaceParent: Boolean) {
        addSubIssue(input: { issueId: $parentId, subIssueId: $subIssueId, replaceParent: $replaceParent }) {
          issue { number }
          subIssue { number }
        }
      }`,
      {
        parentId: parentTicket.nodeId,
        subIssueId: childNodeId,
        replaceParent: opts.replaceParent,
      },
      {
        headers: {
          'GraphQL-Features': 'sub_issues',
        },
      },
    );
  }

  async removeSubIssue(parentNumber, subIssueNumber) {
    const parentTicket = await this.getTicket(parentNumber);
    const childTicket = await this.getTicket(subIssueNumber);

    return this._http.graphql(
      `
      mutation($parentId: ID!, $subIssueId: ID!) {
        removeSubIssue(input: { issueId: $parentId, subIssueId: $subIssueId }) {
          issue { number }
          subIssue { number }
        }
      }`,
      {
        parentId: parentTicket.nodeId,
        subIssueId: childTicket.nodeId,
      },
      {
        headers: {
          'GraphQL-Features': 'sub_issues',
        },
      },
    );
  }

  /**
   * Internal helper to add an item (Issue/PR) to a Project V2 board.
   * @param {string} contentNodeId - GraphQL node ID of the issue/PR.
   * @private
   */
  async _addItemToProject(contentNodeId) {
    const projectId = await this._fetchProjectMetadata();
    if (!projectId) return;

    await this._http.graphql(
      `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId, contentId: contentNodeId },
    );
  }

  /**
   * Internal helper to fetch Project V2 data, checking both User and Organization.
   * @param {string} fragment - GraphQL fragment for the projectNode.
   * @returns {Promise<object|null>}
   * @private
   */
  async _fetchProjectV2(fragment) {
    if (!this.projectNumber) return null;

    const buildQuery = (type) => `
      query($owner: String!, $number: Int!) {
        ${type}(login: $owner) {
          projectV2(number: $number) { ${fragment} }
        }
      }
    `;

    // Try user first
    try {
      const data = await this._http.graphql(buildQuery('user'), {
        owner: this.projectOwner,
        number: this.projectNumber,
      });
      if (data?.user?.projectV2) return data.user.projectV2;
    } catch (err) {
      // User-scoped ProjectV2 lookup failed; try organization scope next.
      console.warn(
        `[GitHubProvider] ProjectV2 user lookup failed (owner=${this.projectOwner}): ${err.message}`,
      );
    }

    // Fallback to organization
    try {
      const data = await this._http.graphql(buildQuery('organization'), {
        owner: this.projectOwner,
        number: this.projectNumber,
      });
      return data?.organization?.projectV2;
    } catch (err) {
      // Org-scoped ProjectV2 lookup failed; caller receives null and degrades to non-project mode.
      console.warn(
        `[GitHubProvider] ProjectV2 org lookup failed (owner=${this.projectOwner}): ${err.message}`,
      );
    }

    return null;
  }

  /**
   * Strict sibling of `_fetchProjectV2` — tries user scope first, then org
   * scope, and rethrows any GraphQL error instead of swallowing it. Used
   * by `ensureStatusField` / `ensureProjectViews` so callers can detect
   * INSUFFICIENT_SCOPES and degrade gracefully.
   *
   * @private
   */
  async _fetchProjectV2Strict(fragment) {
    if (!this.projectNumber) return null;

    const buildQuery = (type) => `
      query($owner: String!, $number: Int!) {
        ${type}(login: $owner) {
          projectV2(number: $number) { ${fragment} }
        }
      }
    `;

    let userErr = null;
    try {
      const data = await this._http.graphql(buildQuery('user'), {
        owner: this.projectOwner,
        number: this.projectNumber,
      });
      if (data?.user?.projectV2) return data.user.projectV2;
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) throw err;
      userErr = err;
    }

    try {
      const data = await this._http.graphql(buildQuery('organization'), {
        owner: this.projectOwner,
        number: this.projectNumber,
      });
      if (data?.organization?.projectV2) return data.organization.projectV2;
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) throw err;
      // If both queries failed non-scope, rethrow the org error so the
      // caller sees a real signal rather than a silent null.
      throw err;
    }

    // If the user query raised a non-scope error and the org query found
    // nothing, surface the original user-scope error rather than null.
    if (userErr) throw userErr;
    return null;
  }

  /**
   * Resolve the global GraphQL node ID for the configured project number.
   * Caches the result to avoid redundant lookups.
   * @private
   */
  /* node:coverage ignore next */
  async _fetchProjectMetadata() {
    if (this._projectId) return this._projectId;
    const project = await this._fetchProjectV2('id');
    if (project) this._projectId = project.id;
    return this._projectId;
  }

  /**
   * Apply label add/remove mutations to an issue.
   *
   * When the only mutation is "add labels", uses the additive labels-API
   * endpoint for atomicity and to avoid a read-before-write. When other
   * PATCH fields are present, or when removing labels, computes the final
   * label set and returns it to the caller for inclusion in the PATCH.
   *
   * @param {number} ticketId
   * @param {{ add?: string[], remove?: string[] }} labels
   * @param {boolean} hasOtherPatchFields Whether the caller will issue a
   *                                       PATCH for non-label fields.
   * @returns {Promise<{ skipPatch: boolean, mergedLabels?: string[] }>}
   *                   skipPatch=true means the labels endpoint handled
   *                   everything and the caller should not PATCH.
   * @private
   */
  async _updateLabels(ticketId, labels, hasOtherPatchFields) {
    const { add = [], remove = [] } = labels;

    // Fast path: only adding labels, nothing else to patch. Use the
    // purpose-built additive endpoint which does not require fetching
    // the current label set first.
    if (add.length > 0 && remove.length === 0 && !hasOtherPatchFields) {
      await this._http.rest(
        `/repos/${this.owner}/${this.repo}/issues/${ticketId}/labels`,
        { method: 'POST', body: { labels: add } },
      );
      return { skipPatch: true };
    }

    // Removals or combined patches require a read-modify-write cycle so the
    // PATCH includes the full target label set.
    const ticket = await this.getTicket(ticketId);
    const currentLabels = new Set(ticket.labels ?? []);
    for (const l of remove) currentLabels.delete(l);
    for (const l of add) currentLabels.add(l);

    return { skipPatch: false, mergedLabels: Array.from(currentLabels) };
  }

  /* node:coverage ignore next */
  async updateTicket(ticketId, mutations) {
    const patch = {};

    if (mutations.body !== undefined) {
      patch.body = mutations.body;
    }
    if (mutations.assignees) {
      patch.assignees = mutations.assignees;
    }
    if (mutations.state !== undefined) {
      patch.state = mutations.state;
    }
    if (mutations.state_reason !== undefined) {
      patch.state_reason = mutations.state_reason;
    }

    if (mutations.labels) {
      const hasOtherPatchFields = Object.keys(patch).length > 0;
      const result = await this._updateLabels(
        ticketId,
        mutations.labels,
        hasOtherPatchFields,
      );
      if (result.skipPatch) return;
      patch.labels = result.mergedLabels;
    }

    if (Object.keys(patch).length > 0) {
      await this._http.rest(
        `/repos/${this.owner}/${this.repo}/issues/${ticketId}`,
        {
          method: 'PATCH',
          body: patch,
        },
      );
      this.invalidateTicket(ticketId);
    }
  }

  /**
   * Delete a single issue comment by its numeric id.
   * @param {number} commentId
   */
  async deleteComment(commentId) {
    await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`,
      { method: 'DELETE' },
    );
  }

  async postComment(ticketId, payload) {
    const typeBadges = {
      progress: '🔄 **Progress**',
      friction: '⚠️ **Friction**',
      notification: '📢 **Notification**',
    };

    const badge = typeBadges[payload.type] ?? '';
    const body = badge ? `${badge}\n\n${payload.body}` : payload.body;

    const comment = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/${ticketId}/comments`,
      { method: 'POST', body: { body } },
    );

    return { commentId: comment.id };
  }

  /* node:coverage ignore next */
  async createPullRequest(branchName, ticketId, baseBranch = 'main') {
    // Fetch the ticket to get its title for the PR
    const ticket = await this.getTicket(ticketId);

    const pr = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/pulls`,
      {
        method: 'POST',
        body: {
          title: ticket.title,
          body: `Closes #${ticketId}`,
          head: branchName,
          base: baseBranch,
        },
      },
    );

    // Add to project if configured
    try {
      if (this.projectNumber) {
        await this._addItemToProject(pr.node_id);
      }
    } catch (err) {
      console.warn(
        `[GitHubProvider] Failed to add PR #${pr.number} to project: ${err.message}`,
      );
    }

    return {
      number: pr.number,
      url: pr.url,
      htmlUrl: pr.html_url,
    };
  }

  /**
   * Inspect branch-protection state for a branch in this repository. A 404
   * means "no protection rule exists"; any other error propagates so the
   * caller can distinguish "intentionally unprotected" from "transport
   * failure." Returns `{ enabled, raw? }`.
   *
   * @param {string} branch
   * @returns {Promise<{ enabled: boolean, raw?: object }>}
   */
  async getBranchProtection(branch) {
    const endpoint = `/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(branch)}/protection`;
    try {
      const raw = await this._http.rest(endpoint);
      return { enabled: true, raw };
    } catch (err) {
      if (/failed \(404\)/.test(err?.message ?? '')) {
        return { enabled: false };
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Setup Operations
  // ---------------------------------------------------------------------------

  async ensureLabels(labelDefs) {
    // Paginate to fetch all existing labels (H-6).
    const existing = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/labels`,
    );
    const existingNames = new Set(existing.map((l) => l.name));

    const created = [];
    const skipped = [];

    for (const def of labelDefs) {
      if (existingNames.has(def.name)) {
        skipped.push(def.name);
        continue;
      }

      await this._http.rest(`/repos/${this.owner}/${this.repo}/labels`, {
        method: 'POST',
        body: {
          name: def.name,
          color: def.color.replace('#', ''),
          description: def.description || '',
        },
      });
      created.push(def.name);
    }

    return { created, skipped };
  }

  /**
   * Detect whether a GraphQL error payload (or its serialised message)
   * represents a missing Projects V2 permission scope. Bootstrap treats
   * these as soft failures: the run logs a warning and continues so that
   * label creation still completes on a token without `project` scope.
   *
   * @param {unknown} err
   * @returns {boolean}
   */
  static isInsufficientScopes(err) {
    if (!err) return false;
    const haystack = err.message ?? err.toString?.() ?? String(err);
    return (
      /INSUFFICIENT_SCOPES/i.test(haystack) ||
      /Resource not accessible by personal access token/i.test(haystack) ||
      /your token has not been granted the required scopes/i.test(haystack)
    );
  }

  /**
   * Resolve the configured Project, or create one if `projectNumber` is not
   * set. Returns `{ projectId, projectNumber, created }`. On insufficient
   * scopes returns `{ scopesMissing: true }` so bootstrap can degrade.
   *
   * @param {{ name?: string|null, owner?: string }} [opts]
   * @returns {Promise<{
   *   projectId?: string,
   *   projectNumber?: number,
   *   created?: boolean,
   *   scopesMissing?: boolean,
   * }>}
   */
  async resolveOrCreateProject(opts = {}) {
    const owner = opts.owner ?? this.projectOwner;
    const name =
      opts.name ?? this.projectName ?? `${this.repo} — Agent Protocols`;

    if (this.projectNumber) {
      try {
        const project = await this._fetchProjectV2('id');
        if (project) {
          this._projectId = project.id;
          return {
            projectId: project.id,
            projectNumber: this.projectNumber,
            created: false,
          };
        }
      } catch (err) {
        if (GitHubProvider.isInsufficientScopes(err)) {
          return { scopesMissing: true };
        }
        throw err;
      }
      throw new Error(
        `[GitHubProvider] Project #${this.projectNumber} not found for ${owner}.`,
      );
    }

    // No projectNumber — attempt to create a Project under the owner.
    let ownerNodeId;
    try {
      const data = await this._http.graphql(
        `query($login: String!) {
          user(login: $login) { id }
          organization(login: $login) { id }
        }`,
        { login: owner },
      );
      ownerNodeId = data?.organization?.id ?? data?.user?.id ?? null;
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err))
        return { scopesMissing: true };
      throw err;
    }

    if (!ownerNodeId) {
      throw new Error(
        `[GitHubProvider] Could not resolve owner node id for "${owner}".`,
      );
    }

    try {
      const data = await this._http.graphql(
        `mutation($ownerId: ID!, $title: String!) {
          createProjectV2(input: { ownerId: $ownerId, title: $title }) {
            projectV2 { id number }
          }
        }`,
        { ownerId: ownerNodeId, title: name },
      );
      const project = data?.createProjectV2?.projectV2;
      if (!project) {
        throw new Error(
          '[GitHubProvider] createProjectV2 returned no project.',
        );
      }
      this._projectId = project.id;
      this.projectNumber = project.number;
      return {
        projectId: project.id,
        projectNumber: project.number,
        created: true,
      };
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err))
        return { scopesMissing: true };
      throw err;
    }
  }

  /**
   * Ensure the Status single-select field exists on the project with the
   * given options. Idempotent — existing options are preserved by id and
   * only missing options are appended. When the underlying mutation is
   * unavailable due to missing scopes, returns `{ scopesMissing: true }`
   * instead of throwing so bootstrap can degrade.
   *
   * @param {string[]} optionNames
   * @returns {Promise<{
   *   status: 'created'|'updated'|'unchanged'|'scopes-missing',
   *   added: string[],
   *   fieldId?: string,
   * }>}
   */
  async ensureStatusField(optionNames) {
    if (!this.projectNumber) {
      throw new Error(
        '[GitHubProvider] ensureStatusField requires projectNumber.',
      );
    }

    let project;
    try {
      project = await this._fetchProjectV2Strict(`
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      `);
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) {
        return { status: 'scopes-missing', added: [] };
      }
      throw err;
    }

    if (!project) {
      throw new Error(
        `[GitHubProvider] Project #${this.projectNumber} not found for ${this.projectOwner}.`,
      );
    }

    const statusField = (project.fields?.nodes ?? []).find(
      (f) => f?.name === 'Status',
    );

    // Field is missing — create it with all desired options.
    if (!statusField) {
      try {
        const data = await this._http.graphql(
          `mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
            createProjectV2Field(input: { projectId: $projectId, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options }) {
              projectV2Field { ... on ProjectV2SingleSelectField { id name } }
            }
          }`,
          {
            projectId: project.id,
            name: 'Status',
            options: optionNames.map((o) => ({
              name: o,
              color: 'GRAY',
              description: '',
            })),
          },
        );
        return {
          status: 'created',
          added: [...optionNames],
          fieldId: data?.createProjectV2Field?.projectV2Field?.id,
        };
      } catch (err) {
        if (GitHubProvider.isInsufficientScopes(err)) {
          return { status: 'scopes-missing', added: [] };
        }
        throw err;
      }
    }

    // Field exists — compute missing options and append them.
    const existing = new Map(
      (statusField.options ?? []).map((o) => [o.name, o.id]),
    );
    const missing = optionNames.filter((name) => !existing.has(name));
    if (missing.length === 0) {
      return { status: 'unchanged', added: [], fieldId: statusField.id };
    }

    const mergedOptions = [
      // Preserve existing options by id so Projects doesn't drop them.
      ...(statusField.options ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        color: 'GRAY',
        description: '',
      })),
      ...missing.map((name) => ({ name, color: 'GRAY', description: '' })),
    ];

    try {
      await this._http.graphql(
        `mutation($fieldId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
          updateProjectV2Field(input: { fieldId: $fieldId, name: $name, singleSelectOptions: $options }) {
            projectV2Field { ... on ProjectV2SingleSelectField { id name } }
          }
        }`,
        { fieldId: statusField.id, name: 'Status', options: mergedOptions },
      );
      return { status: 'updated', added: missing, fieldId: statusField.id };
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) {
        return { status: 'scopes-missing', added: [] };
      }
      throw err;
    }
  }

  /**
   * Best-effort Projects V2 Views creation. GitHub's public GraphQL API does
   * not yet expose a `createProjectV2View` mutation in all contexts; any
   * failure (missing mutation, missing scopes, rate limit) is caught and
   * surfaced as `{ unavailable: true }` so the caller can direct the user
   * to `docs/project-board.md` for manual setup.
   *
   * @param {Array<{ name: string, filter: string, groupBy?: string }>} viewDefs
   * @returns {Promise<{
   *   created: string[],
   *   skipped: string[],
   *   unavailable: boolean,
   * }>}
   */
  async ensureProjectViews(viewDefs) {
    if (!this.projectNumber) {
      throw new Error(
        '[GitHubProvider] ensureProjectViews requires projectNumber.',
      );
    }

    const created = [];
    const skipped = [];

    let project;
    try {
      project = await this._fetchProjectV2Strict(`
        id
        views(first: 50) { nodes { name } }
      `);
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) {
        return {
          created,
          skipped: viewDefs.map((v) => v.name),
          unavailable: true,
        };
      }
      // Treat a schema-level "views field does not exist" failure as
      // unavailable rather than fatal — Projects V2 Views API is GitHub-
      // internal in most contexts as of v5.15.
      return {
        created,
        skipped: viewDefs.map((v) => v.name),
        unavailable: true,
      };
    }

    if (!project) {
      throw new Error(
        `[GitHubProvider] Project #${this.projectNumber} not found for ${this.projectOwner}.`,
      );
    }

    const existingViewNames = new Set(
      (project.views?.nodes ?? []).map((v) => v?.name).filter(Boolean),
    );

    let unavailable = false;
    for (const def of viewDefs) {
      if (existingViewNames.has(def.name)) {
        skipped.push(def.name);
        continue;
      }
      if (unavailable) {
        skipped.push(def.name);
        continue;
      }
      try {
        await this._http.graphql(
          `mutation($projectId: ID!, $name: String!, $filter: String!) {
            createProjectV2View(input: { projectId: $projectId, name: $name, filter: $filter, layout: BOARD_LAYOUT }) {
              projectV2View { id name }
            }
          }`,
          { projectId: project.id, name: def.name, filter: def.filter },
        );
        created.push(def.name);
      } catch (err) {
        // First failure signals the mutation is unavailable in this
        // context — stop attempting subsequent views to avoid noise.
        unavailable = true;
        skipped.push(def.name);
      }
    }

    return { created, skipped, unavailable };
  }

  /* node:coverage ignore next */
  async ensureProjectFields(fieldDefs) {
    if (!this.projectNumber) return { created: [], skipped: [] };

    const project = await this._fetchProjectV2(`
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2Field { name }
          ... on ProjectV2IterationField { name }
          ... on ProjectV2SingleSelectField { name }
        }
      }
    `);

    if (!project) {
      throw new Error(
        `[GitHubProvider] Project #${this.projectNumber} not found for ${this.projectOwner}.`,
      );
    }

    const existingFields = new Set(
      project.fields.nodes.map((f) => f.name).filter(Boolean),
    );

    const created = [];
    const skipped = [];

    for (const def of fieldDefs) {
      if (existingFields.has(def.name)) {
        skipped.push(def.name);
        continue;
      }

      if (def.type === 'iteration') {
        skipped.push(def.name); // Not supported via GraphQL
        continue;
      }

      if (def.type === 'single_select') {
        await this._http.graphql(
          `mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
            createProjectV2Field(input: { projectId: $projectId, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options }) {
              projectV2Field { ... on ProjectV2SingleSelectField { name } }
            }
          }`,
          {
            projectId: project.id,
            name: def.name,
            options: (def.options ?? []).map((o) => ({
              name: o,
              color: 'GRAY',
              description: '',
            })),
          },
        );
      }

      created.push(def.name);
    }

    return { created, skipped };
  }
}
