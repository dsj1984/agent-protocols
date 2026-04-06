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
import { ITicketingProvider } from '../lib/ITicketingProvider.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

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

/**
 * Parse `blocked by #NNN` patterns from issue body text.
 * Supports: "blocked by #123", "depends on #456", "Blocked by #789"
 *
 * @param {string} body - Issue body text.
 * @returns {number[]} Array of issue numbers this ticket is blocked by.
 */
function parseBlockedBy(body) {
  if (!body) return [];
  const re = /(?:blocked by|depends on)\s+#(\d+)/gi;
  const results = [];
  let match;
  while ((match = re.exec(body)) !== null) {
    results.push(parseInt(match[1], 10));
  }
  return results;
}

/**
 * Parse `blocks #NNN` patterns from issue body text.
 *
 * @param {string} body - Issue body text.
 * @returns {number[]} Array of issue numbers this ticket blocks.
 */
function parseBlocks(body) {
  if (!body) return [];
  const re = /blocks\s+#(\d+)/gi;
  const results = [];
  let match;
  while ((match = re.exec(body)) !== null) {
    results.push(parseInt(match[1], 10));
  }
  return results;
}

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
    this.operatorHandle = config.operatorHandle ?? null;
    this._token = opts.token ?? null;
  }

  /** Lazily resolve the token on first API call. */
  get token() {
    if (!this._token) {
      this._token = resolveToken();
    }
    return this._token;
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Make a REST API request to GitHub.
   * @param {string} endpoint - Path relative to GITHUB_API.
   * @param {{ method?: string, body?: object }} [opts]
   * @returns {Promise<object>}
   */
  async _rest(endpoint, opts = {}) {
    const url = `${GITHUB_API}${endpoint}`;
    const method = opts.method ?? 'GET';

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'node.js',
    };

    const fetchOpts = { method, headers };
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `[GitHubProvider] ${method} ${endpoint} failed (${res.status}): ${errorBody}`,
      );
    }

    // 204 No Content
    if (res.status === 204) return null;

    return res.json();
  }

  /**
   * Make a GraphQL API request to GitHub.
   * @param {string} query - GraphQL query/mutation string.
   * @param {object} [variables={}]
   * @param {{ headers?: object }} [opts={}]
   * @returns {Promise<object>} The `data` portion of the response.
   */
  async _graphql(query, variables = {}, opts = {}) {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'node.js',
      ...opts.headers,
    };

    const res = await fetch(GITHUB_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `[GitHubProvider] GraphQL request failed (${res.status}): ${errorBody}`,
      );
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(
        `[GitHubProvider] GraphQL errors: ${JSON.stringify(json.errors)}`,
      );
    }

    return json.data;
  }

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  async getEpics(filters = {}) {
    const params = new URLSearchParams({
      state: filters.state ?? 'all',
      labels: 'type::epic',
      per_page: '100',
    });

    const issues = await this._rest(
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
      }));
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

  async getTickets(epicId, filters = {}) {
    // List all issues that mention the epic in their body
    // We use search to find issues that reference the epic
    const params = new URLSearchParams({
      state: filters.state ?? 'all',
      per_page: '100',
    });
    if (filters.label) {
      params.set('labels', filters.label);
    }

    const issues = await this._rest(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );

    // Filter to only issues that reference the epic
    return issues
      .filter((issue) => {
        if (issue.pull_request) return false; // Skip PRs
        // Check if the issue body contains a reference to the epic
        const body = issue.body ?? '';
        return (
          body.includes(`#${epicId}`) ||
          body.includes(`Epic: #${epicId}`) ||
          body.includes(`parent: #${epicId}`)
        );
      })
      .map((issue) => ({
        id: issue.number,
        internalId: issue.id,
        nodeId: issue.node_id,
        title: issue.title,
        labels: (issue.labels ?? []).map((l) =>
          typeof l === 'string' ? l : l.name,
        ),
        state: issue.state,
      }));
  }

  async getSubTickets(parentId) {
    const parent = await this.getTicket(parentId);
    const body = parent.body || '';
    
    // Match checklist items linking to issues: "- [ ] #123" or "- [x] #123"
    const re = /-\s*\[[ xX]\]\s+#(\d+)/g;
    const childIds = [];
    let match;
    while ((match = re.exec(body)) !== null) {
      childIds.push(parseInt(match[1], 10));
    }
    
    // Removing duplicates if any
    const uniqueChildIds = [...new Set(childIds)];
    
    // Fetch all child tickets
    const subTickets = await Promise.all(
      uniqueChildIds.map(id => this.getTicket(id).catch(() => null))
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

  async getTicketDependencies(ticketId) {
    const ticket = await this.getTicket(ticketId);
    return {
      blocks: parseBlocks(ticket.body),
      blockedBy: parseBlockedBy(ticket.body),
    };
  }

  // ---------------------------------------------------------------------------
  // Write Operations
  // ---------------------------------------------------------------------------

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

    const issue = await this._rest(
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
      await this.addSubIssue(parentId, issue.id);
    } catch {
      // Sub-issues might not be enabled or permission issues — fallback to text-only link (already in body)
    }

    // Add to project if configured
    try {
      if (this.projectNumber) {
        await this._addItemToProject(issue.node_id);
      }
    } catch (err) {
      console.warn(`[GitHubProvider] Failed to add Issue #${issue.number} to project: ${err.message}`);
    }

    return {
      id: issue.number,
      internalId: issue.id,
      nodeId: issue.node_id,
      url: issue.html_url,
    };
  }

  async addSubIssue(parentNumber, childNodeId, opts = { replaceParent: false }) {
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
        replaceParent: opts.replaceParent
      },
      {
        headers: {
          'GraphQL-Features': 'sub_issues'
        }
      }
    );
  }

  async removeSubIssue(parentNumber, subIssueNumber) {
    console.warn(`[GitHubProvider] removeSubIssue called for #${subIssueNumber}. Recommended to use addSubIssue with replaceParent: true instead.`);
  }

  /**
   * Internal helper to add an item (Issue/PR) to a Project V2 board.
   * @param {string} contentNodeId - GraphQL node ID of the issue/PR.
   * @private
   */
  async _addItemToProject(contentNodeId) {
    const projectId = await this._getProjectId();
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
   * Resolve the global GraphQL node ID for the configured project number.
   * Caches the result to avoid redundant lookups.
   * @private
   */
  async _getProjectId() {
    if (this._projectId) return this._projectId;
    if (!this.projectNumber) return null;

    // Try user first
    try {
      const userData = await this._graphql(
        `query($owner: String!, $number: Int!) {
          user(login: $owner) {
            projectV2(number: $number) { id }
          }
        }`,
        { owner: this.owner, number: this.projectNumber },
      );
      this._projectId = userData.user?.projectV2?.id;
    } catch {
      // Fallback to organization check
      try {
        const orgData = await this._graphql(
          `query($owner: String!, $number: Int!) {
            organization(login: $owner) {
              projectV2(number: $number) { id }
            }
          }`,
          { owner: this.owner, number: this.projectNumber },
        );
        this._projectId = orgData.organization?.projectV2?.id;
      } catch {
        // Neither worked — project not found or permission issue
      }
    }

    return this._projectId;
  }

  async updateTicket(ticketId, mutations) {
    const patch = {};

    if (mutations.body !== undefined) {
      patch.body = mutations.body;
    }
    if (mutations.assignees) {
      patch.assignees = mutations.assignees;
    }

    // Handle label mutations — requires separate API calls
    if (mutations.labels) {
      if (mutations.labels.add?.length) {
        for (const label of mutations.labels.add) {
          await this._rest(
            `/repos/${this.owner}/${this.repo}/issues/${ticketId}/labels`,
            { method: 'POST', body: { labels: [label] } },
          );
        }
      }
      if (mutations.labels.remove?.length) {
        for (const label of mutations.labels.remove) {
          try {
            await this._rest(
              `/repos/${this.owner}/${this.repo}/issues/${ticketId}/labels/${encodeURIComponent(label)}`,
              { method: 'DELETE' },
            );
          } catch {
            // Label may not exist on the issue — ignore
          }
        }
      }
    }

    // Only call PATCH if we have non-label mutations
    if (Object.keys(patch).length > 0) {
      await this._rest(
        `/repos/${this.owner}/${this.repo}/issues/${ticketId}`,
        { method: 'PATCH', body: patch },
      );
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

  async createPullRequest(branchName, ticketId) {
    // Fetch the ticket to get its title for the PR
    const ticket = await this.getTicket(ticketId);

    // Determine base branch from config (default to 'main')
    const pr = await this._rest(
      `/repos/${this.owner}/${this.repo}/pulls`,
      {
        method: 'POST',
        body: {
          title: ticket.title,
          body: `Closes #${ticketId}`,
          head: branchName,
          base: 'main',
        },
      },
    );

    // Add to project if configured
    try {
      if (this.projectNumber) {
        await this._addItemToProject(pr.node_id);
      }
    } catch (err) {
      console.warn(`[GitHubProvider] Failed to add PR #${pr.number} to project: ${err.message}`);
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
    // Fetch all existing labels
    const existing = await this._rest(
      `/repos/${this.owner}/${this.repo}/labels?per_page=100`,
    );
    const existingNames = new Set(existing.map((l) => l.name));

    const created = [];
    const skipped = [];

    for (const def of labelDefs) {
      if (existingNames.has(def.name)) {
        skipped.push(def.name);
        continue;
      }

      await this._rest(
        `/repos/${this.owner}/${this.repo}/labels`,
        {
          method: 'POST',
          body: {
            name: def.name,
            color: def.color.replace('#', ''),
            description: def.description || '',
          },
        },
      );
      created.push(def.name);
    }

    return { created, skipped };
  }

  async ensureProjectFields(fieldDefs) {
    if (!this.projectNumber) {
      return { created: [], skipped: [] };
    }

    // First, resolve the project node ID via GraphQL
    const projectData = await this._graphql(`
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            fields(first: 50) {
              nodes {
                ... on ProjectV2Field { name }
                ... on ProjectV2IterationField { name }
                ... on ProjectV2SingleSelectField { name }
              }
            }
          }
        }
      }
    `, { owner: this.owner, number: this.projectNumber });

    // Try organization if user lookup fails
    let project = projectData.user?.projectV2;
    if (!project) {
      const orgData = await this._graphql(`
        query($owner: String!, $number: Int!) {
          organization(login: $owner) {
            projectV2(number: $number) {
              id
              fields(first: 50) {
                nodes {
                  ... on ProjectV2Field { name }
                  ... on ProjectV2IterationField { name }
                  ... on ProjectV2SingleSelectField { name }
                }
              }
            }
          }
        }
      `, { owner: this.owner, number: this.projectNumber });
      project = orgData.organization?.projectV2;
    }

    if (!project) {
      throw new Error(
        `[GitHubProvider] Project #${this.projectNumber} not found for ${this.owner}.`,
      );
    }

    const existingFieldNames = new Set(
      project.fields.nodes.map((f) => f.name).filter(Boolean),
    );

    const created = [];
    const skipped = [];

    for (const def of fieldDefs) {
      if (existingFieldNames.has(def.name)) {
        skipped.push(def.name);
        continue;
      }

      if (def.type === 'single_select') {
        await this._graphql(`
          mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
            createProjectV2Field(input: {
              projectId: $projectId
              dataType: SINGLE_SELECT
              name: $name
              singleSelectOptions: $options
            }) {
              projectV2Field { ... on ProjectV2SingleSelectField { name } }
            }
          }
        `, {
          projectId: project.id,
          name: def.name,
          options: (def.options ?? []).map((o) => ({ name: o, color: 'GRAY', description: '' })),
        });
      }

      // Note: Iteration fields require different GraphQL mutations
      // and are more complex. For now we track them as skipped with a note.
      if (def.type === 'iteration') {
        // Iteration fields cannot be created via GraphQL API currently.
        // They must be created manually in the project settings.
        skipped.push(def.name);
        continue;
      }

      created.push(def.name);
    }

    return { created, skipped };
  }
}
