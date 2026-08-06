/**
 * GitHub Provider — SubIssueGateway.
 *
 * Owns the **read** side of the native GitHub Sub-Issues surface: the
 * GraphQL `subIssues` field on an Issue, paginated into a child-number
 * list. Story #5008 removed the write side (`addSubIssue`,
 * `removeSubIssue`) and the `reconcileSubIssueLinks` walker along with the
 * rest of the Epic-hierarchy provider surface — v2 delivery is Story-only,
 * so nothing establishes or repairs parent/child links any more.
 *
 * Extracted from `../github.js` in Story #2462 / Task #2480. The read path
 * still reaches `GitHubProvider` as `_getNativeSubIssues`, and
 * `IssuesGateway` calls it directly through its `getNativeSubIssues` hook.
 *
 * Constructed with `{ ghGraphql, cache, classifyGithubError }`:
 *   - `ghGraphql(query, variables, opts)`    — bound `_ghGraphql` from the parent.
 *   - `cache.primeIfAbsent(ticket)`          — bound to the shared cache (native-walk priming).
 *
 * The gateway holds **no** transport state of its own — every call goes
 * through the supplied `ghGraphql` hook, which is the parent provider's
 * `gh api graphql` shim.
 *
 * @see Story #2462 — Split GitHubProvider god class into seven composed gateways.
 */

import { Logger } from '../../lib/Logger.js';
import {
  classifyGithubError as defaultClassifyGithubError,
  SUB_ISSUES_QUERY,
  withTransientRetry,
} from './errors.js';
import { subIssueNodeToTicket } from './mappers.js';
import { defaultRetryWarn } from './request-helpers.js';

// Story #2852: cap the native sub-issue cursor walk so a runaway pagination
// (e.g. an upstream API regression that never sets `hasNextPage = false`)
// fails fast instead of looping forever. 50 cursor pages × 100 nodes per
// page = 5000 sub-issues, well above any realistic Epic.
const NATIVE_SUB_ISSUE_PAGE_CAP = 50;

export class SubIssueGateway {
  /**
   * @param {{
   *   ghGraphql: (query: string, variables?: object, opts?: object) => Promise<object>,
   *   cache?: { primeIfAbsent: (ticket: object) => void },
   *   classifyGithubError?: (err: unknown) => string,
   * }} deps
   */
  constructor({
    ghGraphql,
    cache,
    classifyGithubError = defaultClassifyGithubError,
  } = {}) {
    this._ghGraphql = ghGraphql;
    this._cache = cache;
    this._classify = classifyGithubError;
  }

  /**
   * Strategy 1 — native GitHub Sub-Issues via GraphQL. Paginates and seeds
   * the ticket cache via the supplied `cache.primeIfAbsent` hook. Returns
   * `[]` (not throw) when the feature is disabled on this repo.
   */
  async getNativeSubIssues(parentNodeId, parentId) {
    const childIds = [];
    let cursor = null;
    try {
      for (let walked = 0; walked < NATIVE_SUB_ISSUE_PAGE_CAP; walked++) {
        const data = await withTransientRetry(
          () =>
            this._ghGraphql(
              SUB_ISSUES_QUERY,
              { id: parentNodeId, cursor },
              { headers: { 'GraphQL-Features': 'sub_issues' } },
            ),
          {
            label: `getNativeSubIssues parent=#${parentId}`,
            classify: this._classify,
            onRetry: defaultRetryWarn,
          },
        );
        const page = data.node?.subIssues;
        const nodes = page?.nodes ?? [];
        for (const node of nodes) {
          childIds.push(node.number);
          if (this._cache?.primeIfAbsent) {
            this._cache.primeIfAbsent(subIssueNodeToTicket(node));
          }
        }
        if (!page?.pageInfo?.hasNextPage) return childIds;
        cursor = page.pageInfo.endCursor;
        if (walked === NATIVE_SUB_ISSUE_PAGE_CAP - 1) {
          throw new Error(
            `[getNativeSubIssues] cursor cap exceeded for parent #${parentId} ` +
              `(cap=${NATIVE_SUB_ISSUE_PAGE_CAP}, collected=${childIds.length})`,
          );
        }
      }
    } catch (err) {
      const category = this._classify(err);
      if (category === 'feature-disabled') {
        Logger.warn(
          `[GitHubProvider] sub-issues GraphQL unavailable (parent #${parentId}); using checklist fallback`,
        );
        return [];
      }
      Logger.error(
        `[GitHubProvider] sub-issues GraphQL failed (parent #${parentId}, category=${category}): ${err.message}`,
      );
      throw err;
    }
    return childIds;
  }
}
