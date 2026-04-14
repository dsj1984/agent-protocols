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
    this.operatorHandle = config.operatorHandle ?? null;
    // Injectable HTTP transport. The tokenProvider closure captures opts.token
    // so tests can construct with an explicit token without touching env/gh.
    this._http =
      opts.http ??
      new GithubHttpClient({
        tokenProvider: () => opts.token ?? resolveToken(),
        fetchImpl: opts.fetchImpl,
      });
  }

  /** Lazily resolve the token on first API call. */
  get token() {
    return this._http.token;
  }

  // ── Transport proxies ─────────────────────────────────────────────────────
  // The class keeps these underscored method names so existing call sites
  // throughout the file (and any tests mocking `global.fetch`) continue to
  // work unchanged. All four delegate to `_http`.

  async _rest(endpoint, opts = {}) {
    return this._http.rest(endpoint, opts);
  }

  async _graphql(query, variables = {}, opts = {}) {
    return this._http.graphql(query, variables, opts);
  }

  async graphql(query, variables = {}, opts = {}) {
    return this._http.graphql(query, variables, opts);
  }

  async _restPaginated(endpoint) {
    return this._http.restPaginated(endpoint);
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

    const issues = await this._restPaginated(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );

    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        id: issue.number,
        title: issue.title,
        labels: (issue.labels ?? []).map((l) =>
          typeof l === 'string' ? l : l.name,
        ),
        state: issue.state,
        state_reason: issue.state_reason,
      }));
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
    const issue = await this._rest(
      `/repos/${this.owner}/${this.repo}/issues/${epicId}`,
    );

    const labels = (issue.labels ?? []).map((l) =>
      typeof l === 'string' ? l : l.name,
    );

    // Parse linked context issues from the body
    const linkedIssues = { prd: null, techSpec: null };
    if (issue.body) {
      // Look for references like "PRD: #42" or "Tech Spec: #43"
      const prdMatch = issue.body.match(/(?:PRD|prd)[:\s]+#(\d+)/);
      if (prdMatch) linkedIssues.prd = parseInt(prdMatch[1], 10);

      const specMatch = issue.body.match(
        /(?:Tech Spec|tech.?spec|technical.?spec)[:\s]+#(\d+)/i,
      );
      if (specMatch) linkedIssues.techSpec = parseInt(specMatch[1], 10);
    }

    return {
      id: issue.number,
      internalId: issue.id,
      nodeId: issue.node_id,
      title: issue.title,
      body: issue.body ?? '',
      labels,
      linkedIssues,
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

    const issues = await this._restPaginated(
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
      .map((issue) => ({
        id: issue.number,
        internalId: issue.id,
        nodeId: issue.node_id,
        title: issue.title,
        body: issue.body ?? '',
        labels: (issue.labels ?? []).map((l) =>
          typeof l === 'string' ? l : l.name,
        ),
        state: issue.state,
      }));
  }

  async getSubTickets(parentId) {
    const parent = await this.getTicket(parentId);
    const body = parent.body || '';

    // Primary: Native GitHub Sub-Issues (v5 source of truth)
    let nativeChildIds = [];
    try {
      const data = await this._graphql(
        `query($id: ID!) {
          node(id: $id) {
            ... on Issue {
              subIssues(first: 50) {
                nodes { number }
              }
            }
          }
        }`,
        { id: parent.nodeId },
        { headers: { 'GraphQL-Features': 'sub_issues' } },
      );
      nativeChildIds = (data.node?.subIssues?.nodes || []).map((n) => n.number);
    } catch (err) {
      // GraphQL feature might not be enabled or permission error — proceed with checkboxes only
      console.warn(
        `[GitHubProvider] sub-issues GraphQL fallback (parent #${parentId}): ${err.message}`,
      );
    }

    // Secondary: Match checklist items linking to issues: "- [ ] #123" or "- [x] #123"
    const re = /-\s*\[[ xX]\]\s+#(\d+)/g;
    const checklistChildIds = [...body.matchAll(re)].map((m) =>
      parseInt(m[1], 10),
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
    const issue = await this._rest(
      `/repos/${this.owner}/${this.repo}/issues/${ticketId}`,
    );

    return {
      id: issue.number,
      internalId: issue.id,
      nodeId: issue.node_id,
      title: issue.title,
      body: issue.body ?? '',
      labels: (issue.labels ?? []).map((l) =>
        typeof l === 'string' ? l : l.name,
      ),
      assignees: (issue.assignees ?? []).map((a) => a.login),
      state: issue.state,
    };
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
    const comments = await this._rest(
      `/repos/${this.owner}/${this.repo}/issues/comments?sort=created&direction=desc&per_page=${limit}`,
    );
    return comments || [];
  }

  async getTicketComments(ticketId) {
    const comments = await this._restPaginated(
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

    const issue = await this._rest(`/repos/${this.owner}/${this.repo}/issues`, {
      method: 'POST',
      body: {
        title: ticketData.title,
        body: bodyParts.join('\n'),
        labels: ticketData.labels ?? [],
      },
    });

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

    return this._graphql(
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

    return this._graphql(
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

    await this._graphql(
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
      const data = await this._graphql(buildQuery('user'), {
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
      const data = await this._graphql(buildQuery('organization'), {
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
      await this._rest(
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
      await this._rest(`/repos/${this.owner}/${this.repo}/issues/${ticketId}`, {
        method: 'PATCH',
        body: patch,
      });
    }
  }

  async postComment(ticketId, payload) {
    const typeBadges = {
      progress: '🔄 **Progress**',
      friction: '⚠️ **Friction**',
      notification: '📢 **Notification**',
    };

    const badge = typeBadges[payload.type] ?? '';
    const body = badge ? `${badge}\n\n${payload.body}` : payload.body;

    const comment = await this._rest(
      `/repos/${this.owner}/${this.repo}/issues/${ticketId}/comments`,
      { method: 'POST', body: { body } },
    );

    return { commentId: comment.id };
  }

  /* node:coverage ignore next */
  async createPullRequest(branchName, ticketId, baseBranch = 'main') {
    // Fetch the ticket to get its title for the PR
    const ticket = await this.getTicket(ticketId);

    const pr = await this._rest(`/repos/${this.owner}/${this.repo}/pulls`, {
      method: 'POST',
      body: {
        title: ticket.title,
        body: `Closes #${ticketId}`,
        head: branchName,
        base: baseBranch,
      },
    });

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

  // ---------------------------------------------------------------------------
  // Setup Operations
  // ---------------------------------------------------------------------------

  async ensureLabels(labelDefs) {
    // Paginate to fetch all existing labels (H-6).
    const existing = await this._restPaginated(
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

      await this._rest(`/repos/${this.owner}/${this.repo}/labels`, {
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
        await this._graphql(
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
