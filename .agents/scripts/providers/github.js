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
 * This file is the public facade. The supporting modules under
 * `providers/github/` own focused slices of behaviour:
 *   - `ticket-mapper.js`  — pure REST/GraphQL-payload → ticket shape
 *   - `graphql-builder.js` — named GraphQL query/mutation strings
 *   - `cache-manager.js`   — per-instance ticket cache over lib/CacheLayer
 *   - `error-classifier.js` — GraphQL error → category
 *
 * @see docs/v5-implementation-plan.md Sprint 1B
 */

import { execSync as defaultExecSync } from 'node:child_process';

// Test seam: execSync is indirected through this holder so tests can swap
// it via `__setExecSyncForTests`. Production always uses the real impl.
const execSyncHolder = { impl: defaultExecSync };
export function __setExecSyncForTests(fn) {
  execSyncHolder.impl = fn ?? defaultExecSync;
}
import { parseBlockedBy, parseBlocks } from '../lib/dependency-parser.js';
import { ITicketingProvider } from '../lib/ITicketingProvider.js';
import { TYPE_LABELS } from '../lib/label-constants.js';
import { createTicketCacheManager } from './github/cache-manager.js';
import { classifyGithubError } from './github/error-classifier.js';
import {
  ADD_PROJECT_ITEM_MUTATION,
  ADD_SUB_ISSUE_MUTATION,
  buildProjectV2LookupQuery,
  CREATE_PROJECT_MUTATION,
  CREATE_PROJECT_VIEW_MUTATION,
  CREATE_SINGLE_SELECT_FIELD_MUTATION,
  OWNER_NODE_LOOKUP_QUERY,
  PROJECT_FIELDS_FRAGMENT,
  PROJECT_VIEWS_FRAGMENT,
  REMOVE_SUB_ISSUE_MUTATION,
  STATUS_FIELD_FRAGMENT,
  SUB_ISSUES_QUERY,
  UPDATE_SINGLE_SELECT_FIELD_MUTATION,
} from './github/graphql-builder.js';
import {
  issueToEpic,
  issueToEpicListItem,
  issueToListItem,
  issueToTicket,
  subIssueNodeToTicket,
} from './github/ticket-mapper.js';
import { GithubHttpClient } from './github-http-client.js';

/**
 * Resolve the GitHub token from environment or CLI.
 *
 * Hierarchy:
 *   1. Explicit GITHUB_TOKEN or GH_TOKEN env var (CI/CD / Manual)
 *   2. `gh auth token` CLI (Local development)
 *
 * @returns {string} The GitHub personal access token.
 * @throws {Error} If no token can be resolved.
 */
/* node:coverage ignore next */
function resolveToken() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) return token;

  try {
    const ghToken = execSyncHolder
      .impl('gh auth token', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      .trim();
    if (ghToken) {
      // Memoize across subsequent provider constructions. Only set when
      // unset — never overwrite an operator-supplied token (Tech Spec #555,
      // Security & Privacy — Token memoization).
      if (!process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = ghToken;
      return ghToken;
    }
  } catch {
    // gh CLI not installed or not authenticated
  }

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
    this._http =
      opts.http ??
      new GithubHttpClient({
        tokenProvider: () => opts.token ?? resolveToken(),
        fetchImpl: opts.fetchImpl,
      });

    // Per-instance ticket cache. A ticket fetched by the dispatcher,
    // reconciler, and cascade all share the same network round-trip.
    // `updateTicket` / `postComment` invalidate the entry. List endpoints
    // (`getTickets`, `getSubTickets`) deliberately do NOT populate this
    // cache — they page through many issues where staleness is a concern.
    this._cache = createTicketCacheManager();
  }

  /** Lazily resolve the token on first API call. */
  get token() {
    return this._http.token;
  }

  async graphql(query, variables = {}, opts = {}) {
    return this._http.graphql(query, variables, opts);
  }

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  /**
   * @param {{ state?: 'open'|'closed'|'all' }} filters
   * @returns {Promise<Array>}
   * @private
   */
  async _getEpics(filters = {}) {
    const params = new URLSearchParams({
      state: filters.state ?? 'all',
      labels: TYPE_LABELS.EPIC,
    });

    const issues = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );

    return issues
      .filter((issue) => !issue.pull_request)
      .map(issueToEpicListItem);
  }

  /* node:coverage ignore next */
  async listIssues(filters = {}) {
    return this._getEpics(filters);
  }

  /**
   * Paginated list of open issues filtered by a label query.
   *
   * Used by `StatePoller#bulkLabelPoll` to batch a whole wave's state reads
   * into one paginated request. Returns raw issue objects (PRs filtered out)
   * so the caller can shape-check `{ number, labels }` and demote to the
   * per-ticket fallback on any malformed entry.
   *
   * @param {{ state?: 'open'|'closed'|'all', labels?: string }} [opts]
   * @returns {Promise<Array<object>>}
   */
  async listIssuesByLabel({ state = 'open', labels } = {}) {
    const params = new URLSearchParams({ state });
    if (labels) params.set('labels', labels);
    const issues = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );
    return issues.filter((issue) => !issue?.pull_request);
  }

  /* node:coverage ignore next */
  async getEpics(filters = {}) {
    return this._getEpics(filters);
  }

  async getEpic(epicId) {
    const issue = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/${epicId}`,
    );
    return issueToEpic(issue);
  }

  /* node:coverage ignore next */
  async getTickets(epicId, filters = {}) {
    const params = new URLSearchParams({
      state: filters.state ?? 'all',
    });
    if (filters.label) {
      params.set('labels', filters.label);
    }

    const issues = await this._http.restPaginated(
      `/repos/${this.owner}/${this.repo}/issues?${params}`,
    );

    // Word-boundary regex prevents #1 matching #10, #100, etc. (C-2).
    const epicRefRe = new RegExp(
      `(?:Epic:\\s*#${epicId}|parent:\\s*#${epicId})(?:\\s|$|[,.)\\]])`,
    );

    return issues
      .filter((issue) => {
        if (issue.pull_request) return false;
        const body = issue.body ?? '';
        return epicRefRe.test(body);
      })
      .map(issueToListItem);
  }

  /**
   * Strategy 1 — primary source: native GitHub Sub-Issues (v5 source of
   * truth). Paginates the GraphQL `subIssues` connection, seeding the
   * ticket cache along the way so the caller's subsequent `getTicket`
   * calls resolve from memory. Returns an empty list (not throw) when the
   * feature is disabled on this repo — all other GraphQL errors propagate.
   * @private
   */
  async _getNativeSubIssues(parentNodeId, parentId) {
    const childIds = [];
    let cursor = null;
    try {
      while (true) {
        const subIssuesPage = await this._http.graphql(
          SUB_ISSUES_QUERY,
          { id: parentNodeId, cursor },
          { headers: { 'GraphQL-Features': 'sub_issues' } },
        );

        const page = subIssuesPage.node?.subIssues;
        const nodes = page?.nodes ?? [];
        for (const node of nodes) {
          childIds.push(node.number);
          // Only seed on a miss — an existing entry may be newer
          // (e.g. refreshed after a mutation invalidated it).
          this._cache.primeIfAbsent(subIssueNodeToTicket(node));
        }

        if (!page?.pageInfo?.hasNextPage) break;
        cursor = page.pageInfo.endCursor;
      }
    } catch (err) {
      const category = classifyGithubError(err);
      if (category === 'feature-disabled') {
        console.warn(
          `[GitHubProvider] sub-issues GraphQL unavailable (parent #${parentId}); using checklist fallback`,
        );
        return [];
      }
      console.error(
        `[GitHubProvider] sub-issues GraphQL failed (parent #${parentId}, category=${category}): ${err.message}`,
      );
      throw err;
    }
    return childIds;
  }

  /**
   * Strategy 2 — secondary source: parse Markdown checklist links of the
   * form `- [ ] #123` / `- [x] #123` out of the parent body.
   * Pure parsing; no I/O.
   * @private
   */
  _getChecklistChildren(parentBody) {
    const re = /-\s*\[[ xX]\]\s+#(\d+)/g;
    return [...(parentBody ?? '').matchAll(re)].map((m) =>
      Number.parseInt(m[1], 10),
    );
  }

  /**
   * Strategy 3 — tertiary fallback: reverse-search for issues that
   * reference the parent in their body (`Epic: #N` / `parent: #N`). Only
   * safe for Epic parents — running against Story/Feature parents would
   * pull in sibling tickets and waste API quota.
   * Non-fatal on error — returns an empty list and logs a warning.
   * @private
   */
  async _getReferencedChildren(parentId, parentLabels) {
    const isEpicParent = (parentLabels ?? []).includes(TYPE_LABELS.EPIC);
    if (!isEpicParent) return [];
    try {
      const issues = await this.getTickets(parentId);
      this.primeTicketCache(issues);
      return issues.map((i) => i.id);
    } catch (err) {
      console.warn(
        `[GitHubProvider] reverse dependency lookup (parent #${parentId}): ${err.message}`,
      );
      return [];
    }
  }

  async getSubTickets(parentId) {
    const parent = await this.getTicket(parentId);

    const [nativeChildIds, checklistChildIds, referencedChildIds] =
      await Promise.all([
        this._getNativeSubIssues(parent.nodeId, parentId),
        Promise.resolve(this._getChecklistChildren(parent.body)),
        this._getReferencedChildren(parentId, parent.labels),
      ]);

    // Dedupe while preserving the historical fallback order: native first,
    // then checklist, then reverse-referenced. Order matters for downstream
    // consumers that rank tickets by source trust.
    const allChildIds = [
      ...new Set([
        ...nativeChildIds,
        ...checklistChildIds,
        ...referencedChildIds,
      ]),
    ];

    const subTickets = await Promise.all(
      allChildIds.map((id) => this.getTicket(id).catch(() => null)),
    );
    return subTickets.filter(Boolean);
  }

  async getTicket(ticketId, opts = {}) {
    if (!opts.fresh) {
      if (Number.isFinite(opts.maxAgeMs)) {
        const fresh = this._cache.peekFresh(ticketId, opts.maxAgeMs);
        if (fresh !== undefined) return fresh;
      } else if (this._cache.has(ticketId)) {
        return this._cache.peek(ticketId);
      }
    }

    const issue = await this._http.rest(
      `/repos/${this.owner}/${this.repo}/issues/${ticketId}`,
    );
    const ticket = issueToTicket(issue);
    this._cache.set(ticketId, ticket);
    return ticket;
  }

  /**
   * Seed the per-instance getTicket cache with tickets already hydrated by
   * callers (e.g. from a single `getTickets(epicId)` sweep).
   */
  primeTicketCache(tickets) {
    this._cache.primeMany(tickets);
  }

  /** Drop a specific ticket from the cache. Called after any mutation. */
  invalidateTicket(ticketId) {
    this._cache.invalidate(ticketId);
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

    try {
      await this.addSubIssue(parentId, issue.node_id);
    } catch (err) {
      console.warn(
        `[GitHubProvider] sub-issue link failed for #${issue.number} → parent #${parentId}: ${err.message}`,
      );
    }

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
      ADD_SUB_ISSUE_MUTATION,
      {
        parentId: parentTicket.nodeId,
        subIssueId: childNodeId,
        replaceParent: opts.replaceParent,
      },
      { headers: { 'GraphQL-Features': 'sub_issues' } },
    );
  }

  async removeSubIssue(parentNumber, subIssueNumber) {
    const parentTicket = await this.getTicket(parentNumber);
    const childTicket = await this.getTicket(subIssueNumber);
    return this._http.graphql(
      REMOVE_SUB_ISSUE_MUTATION,
      { parentId: parentTicket.nodeId, subIssueId: childTicket.nodeId },
      { headers: { 'GraphQL-Features': 'sub_issues' } },
    );
  }

  /**
   * @param {string} contentNodeId - GraphQL node ID of the issue/PR.
   * @private
   */
  async _addItemToProject(contentNodeId) {
    const projectId = await this._fetchProjectMetadata();
    if (!projectId) return;
    await this._http.graphql(ADD_PROJECT_ITEM_MUTATION, {
      projectId,
      contentId: contentNodeId,
    });
  }

  /**
   * Fetch Project V2 data, checking both User and Organization scopes. Soft
   * failures (warn + return null) so callers degrade gracefully.
   * @private
   */
  async _fetchProjectV2(fragment) {
    if (!this.projectNumber) return null;

    try {
      const userProjectData = await this._http.graphql(
        buildProjectV2LookupQuery('user', fragment),
        { owner: this.projectOwner, number: this.projectNumber },
      );
      if (userProjectData?.user?.projectV2)
        return userProjectData.user.projectV2;
    } catch (err) {
      console.warn(
        `[GitHubProvider] ProjectV2 user lookup failed (owner=${this.projectOwner}): ${err.message}`,
      );
    }

    try {
      const orgProjectData = await this._http.graphql(
        buildProjectV2LookupQuery('organization', fragment),
        { owner: this.projectOwner, number: this.projectNumber },
      );
      return orgProjectData?.organization?.projectV2;
    } catch (err) {
      console.warn(
        `[GitHubProvider] ProjectV2 org lookup failed (owner=${this.projectOwner}): ${err.message}`,
      );
    }

    return null;
  }

  /**
   * Strict sibling of `_fetchProjectV2` — rethrows instead of swallowing
   * so callers can detect INSUFFICIENT_SCOPES and degrade.
   * @private
   */
  async _fetchProjectV2Strict(fragment) {
    if (!this.projectNumber) return null;

    let userErr = null;
    try {
      const userProjectData = await this._http.graphql(
        buildProjectV2LookupQuery('user', fragment),
        { owner: this.projectOwner, number: this.projectNumber },
      );
      if (userProjectData?.user?.projectV2)
        return userProjectData.user.projectV2;
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) throw err;
      userErr = err;
    }

    try {
      const orgProjectData = await this._http.graphql(
        buildProjectV2LookupQuery('organization', fragment),
        { owner: this.projectOwner, number: this.projectNumber },
      );
      if (orgProjectData?.organization?.projectV2)
        return orgProjectData.organization.projectV2;
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) throw err;
      throw err;
    }

    if (userErr) throw userErr;
    return null;
  }

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
   * @private
   */
  async _updateLabels(ticketId, labels, hasOtherPatchFields) {
    const { add = [], remove = [] } = labels;

    if (add.length > 0 && remove.length === 0 && !hasOtherPatchFields) {
      await this._http.rest(
        `/repos/${this.owner}/${this.repo}/issues/${ticketId}/labels`,
        { method: 'POST', body: { labels: add } },
      );
      return { skipPatch: true };
    }

    const ticket = await this.getTicket(ticketId);
    const currentLabels = new Set(ticket.labels ?? []);
    for (const l of remove) currentLabels.delete(l);
    for (const l of add) currentLabels.add(l);

    return { skipPatch: false, mergedLabels: Array.from(currentLabels) };
  }

  /* node:coverage ignore next */
  async updateTicket(ticketId, mutations) {
    const patch = {};

    if (mutations.body !== undefined) patch.body = mutations.body;
    if (mutations.assignees) patch.assignees = mutations.assignees;
    if (mutations.state !== undefined) patch.state = mutations.state;
    if (mutations.state_reason !== undefined)
      patch.state_reason = mutations.state_reason;

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
        { method: 'PATCH', body: patch },
      );
      this.invalidateTicket(ticketId);
    }
  }

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

    try {
      if (this.projectNumber) {
        await this._addItemToProject(pr.node_id);
      }
    } catch (err) {
      console.warn(
        `[GitHubProvider] Failed to add PR #${pr.number} to project: ${err.message}`,
      );
    }

    return { number: pr.number, url: pr.url, htmlUrl: pr.html_url };
  }

  /**
   * Inspect branch-protection state. A 404 means "no protection rule
   * exists"; any other error propagates so the caller can distinguish
   * "intentionally unprotected" from "transport failure."
   */
  async getBranchProtection(branch) {
    const endpoint = `/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(branch)}/protection`;
    try {
      const raw = await this._http.rest(endpoint);
      return { enabled: true, raw };
    } catch (err) {
      if (/failed \(404\)/.test(err?.message ?? '')) return { enabled: false };
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Setup Operations
  // ---------------------------------------------------------------------------

  async ensureLabels(labelDefs) {
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
   * Detect whether a GraphQL error represents a missing Projects V2
   * permission scope. Bootstrap treats these as soft failures.
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
   * set. On insufficient scopes returns `{ scopesMissing: true }` so
   * bootstrap can degrade.
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
        if (GitHubProvider.isInsufficientScopes(err))
          return { scopesMissing: true };
        throw err;
      }
      throw new Error(
        `[GitHubProvider] Project #${this.projectNumber} not found for ${owner}.`,
      );
    }

    let ownerNodeId;
    try {
      const ownerLookupData = await this._http.graphql(
        OWNER_NODE_LOOKUP_QUERY,
        { login: owner },
      );
      ownerNodeId =
        ownerLookupData?.organization?.id ?? ownerLookupData?.user?.id ?? null;
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
      const createProjectData = await this._http.graphql(
        CREATE_PROJECT_MUTATION,
        { ownerId: ownerNodeId, title: name },
      );
      const project = createProjectData?.createProjectV2?.projectV2;
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
   * given options. Idempotent. When the mutation is unavailable due to
   * missing scopes, returns `{ status: 'scopes-missing', added: [] }`.
   */
  async ensureStatusField(optionNames) {
    if (!this.projectNumber) {
      throw new Error(
        '[GitHubProvider] ensureStatusField requires projectNumber.',
      );
    }

    let project;
    try {
      project = await this._fetchProjectV2Strict(STATUS_FIELD_FRAGMENT);
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err))
        return { status: 'scopes-missing', added: [] };
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

    if (!statusField) {
      try {
        const createFieldData = await this._http.graphql(
          CREATE_SINGLE_SELECT_FIELD_MUTATION,
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
          fieldId: createFieldData?.createProjectV2Field?.projectV2Field?.id,
        };
      } catch (err) {
        if (GitHubProvider.isInsufficientScopes(err))
          return { status: 'scopes-missing', added: [] };
        throw err;
      }
    }

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
      await this._http.graphql(UPDATE_SINGLE_SELECT_FIELD_MUTATION, {
        fieldId: statusField.id,
        name: 'Status',
        options: mergedOptions,
      });
      return { status: 'updated', added: missing, fieldId: statusField.id };
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err))
        return { status: 'scopes-missing', added: [] };
      throw err;
    }
  }

  /**
   * Best-effort Projects V2 Views creation. Any failure (missing mutation,
   * missing scopes, rate limit) is caught and surfaced as
   * `{ unavailable: true }` so the caller can direct the user to
   * `docs/project-board.md` for manual setup.
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
      project = await this._fetchProjectV2Strict(PROJECT_VIEWS_FRAGMENT);
    } catch (err) {
      if (GitHubProvider.isInsufficientScopes(err)) {
        return {
          created,
          skipped: viewDefs.map((v) => v.name),
          unavailable: true,
        };
      }
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
        await this._http.graphql(CREATE_PROJECT_VIEW_MUTATION, {
          projectId: project.id,
          name: def.name,
          filter: def.filter,
        });
        created.push(def.name);
      } catch {
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

    const project = await this._fetchProjectV2(PROJECT_FIELDS_FRAGMENT);

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
        await this._http.graphql(CREATE_SINGLE_SELECT_FIELD_MUTATION, {
          projectId: project.id,
          name: def.name,
          options: (def.options ?? []).map((o) => ({
            name: o,
            color: 'GRAY',
            description: '',
          })),
        });
      }

      created.push(def.name);
    }

    return { created, skipped };
  }
}
