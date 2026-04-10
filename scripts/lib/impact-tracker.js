import { FrictionService } from './friction-service.js';
import { Logger } from './Logger.js';

export class ImpactTracker {
  /**
   * @param {import('./ITicketingProvider.js').ITicketingProvider} provider
   */
  constructor(provider) {
    this.provider = provider;
    this.frictionService = new FrictionService(provider);
  }

  /**
   * Identifies merged protocol refinement PRs and reports on their impact.
   *
   * @param {number} [daysSince=14] - Look-back window in days for pre/post merge tasks.
   */
  async trackImpact(daysSince = 14) {
    Logger.info(
      `[ImpactTracker] Starting impact analysis loop (look-back: ${daysSince} days)...`,
    );

    // 1. Find recently merged PRs with a 'refinement::' label
    const prs = await this._getMergedRefinementPRs();
    Logger.debug(
      `[ImpactTracker] Found ${prs.length} eligible refinement PRs.`,
    );

    for (const pr of prs) {
      if (this._hasImpactReport(pr)) {
        Logger.debug(
          `[ImpactTracker] PR #${pr.number} already has an impact report. Skipping.`,
        );
        continue;
      }

      const label = pr.labels.find((l) => l.startsWith('refinement::'));
      if (!label) continue;

      const category = label.split('::')[1];
      if (!category) continue;

      Logger.info(
        `[ImpactTracker] Analyzing impact for PR #${pr.number} (Category: ${category})...`,
      );

      // 2. Fetch pre-merge and post-merge tasks
      const mergeDate = new Date(pr.mergedAt);

      const [preMergeTasks, postMergeTasks] = await Promise.all([
        this._getTasksBefore(mergeDate, daysSince),
        this._getTasksAfter(mergeDate),
      ]);

      Logger.debug(
        `[ImpactTracker] Found ${preMergeTasks.length} pre-merge tasks, ${postMergeTasks.length} post-merge tasks.`,
      );

      // 3. Ingest friction logs for these tasks
      const preMergeLogs =
        await this.frictionService.parseFrictionLogsForTasks(preMergeTasks);
      const postMergeLogs =
        await this.frictionService.parseFrictionLogsForTasks(postMergeTasks);

      // 4. Calculate friction rates for the specific category
      const prePatternEvents = preMergeLogs.filter(
        (l) =>
          l.category &&
          l.category.toLowerCase().replace(/\s+/g, '-') === category,
      ).length;
      const postPatternEvents = postMergeLogs.filter(
        (l) =>
          l.category &&
          l.category.toLowerCase().replace(/\s+/g, '-') === category,
      ).length;

      const preRate =
        preMergeTasks.length > 0 ? prePatternEvents / preMergeTasks.length : 0;
      const postRate =
        postMergeTasks.length > 0
          ? postPatternEvents / postMergeTasks.length
          : 0;

      // 5. Post summary comment
      const report = this._generateReportMarkdown(
        pr.number,
        category,
        preMergeTasks.length,
        prePatternEvents,
        preRate,
        postMergeTasks.length,
        postPatternEvents,
        postRate,
      );

      await this.provider.postComment(pr.number, {
        type: 'notification',
        body: report,
      });

      Logger.info(`[ImpactTracker] Posted impact report on PR #${pr.number}.`);
    }

    Logger.info(`[ImpactTracker] Impact analysis complete.`);
  }

  async _getMergedRefinementPRs() {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: MERGED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              title
              mergedAt
              labels(first: 10) {
                nodes { name }
              }
              comments(last: 20) {
                nodes { body }
              }
            }
          }
        }
      }
    `;

    // We access the hidden `owner` and `repo` from the provider instance.
    // While _rest is private, owner/repo are public properties defined in constructor.
    const data = await this.provider.graphql(query, {
      owner: this.provider.owner,
      repo: this.provider.repo,
    });

    const prs = data.repository?.pullRequests?.nodes || [];
    return prs
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        mergedAt: pr.mergedAt,
        labels: pr.labels.nodes.map((n) => n.name),
        comments: pr.comments.nodes.map((n) => n.body),
      }))
      .filter((pr) => pr.labels.some((l) => l.startsWith('refinement::')));
  }

  _hasImpactReport(pr) {
    return pr.comments.some((body) => body.includes('<!-- impact-report -->'));
  }

  async _getTasksBefore(targetDate, daysSince) {
    const fromDate = new Date(
      targetDate.getTime() - daysSince * 24 * 60 * 60 * 1000,
    );
    return this._queryTasksByDateRange(fromDate, targetDate);
  }

  async _getTasksAfter(targetDate) {
    const toDate = new Date(); // now
    return this._queryTasksByDateRange(targetDate, toDate);
  }

  async _queryTasksByDateRange(fromDate, toDate) {
    // using GraphQL issue search or REST parameter issue search
    // Using GraphQL to search issues matching the criteria
    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();
    const searchQuery = `repo:${this.provider.owner}/${this.provider.repo} is:issue label:type::task closed:${fromIso.split('T')[0]}..${toIso.split('T')[0]}`;

    const query = `
      query($searchQuery: String!) {
        search(query: $searchQuery, type: ISSUE, first: 100) {
          nodes {
            ... on Issue {
              number
              closedAt
            }
          }
        }
      }
    `;

    const data = await this.provider.graphql(query, { searchQuery });
    const nodes = data.search?.nodes || [];

    // Exact filtering since search API is date-only resolution
    return nodes
      .filter((n) => n?.closedAt)
      .filter((n) => {
        const closedAt = new Date(n.closedAt);
        return closedAt >= fromDate && closedAt <= toDate;
      })
      .map((n) => ({ id: n.number })); // Need internal id format, just number works for comment fetching
  }

  _generateReportMarkdown(
    _prNumber,
    category,
    preCount,
    preEvents,
    preRate,
    postCount,
    postEvents,
    postRate,
  ) {
    const diff = postRate - preRate;
    const trend =
      diff < 0 ? '📉 Decreased' : diff > 0 ? '📈 Increased' : '➡️ Unchanged';
    const pct = preRate > 0 ? `${((diff / preRate) * 100).toFixed(1)}%` : 'N/A';

    return `<!-- impact-report -->
## Impact Analysis Report

An autonomous impact analysis has been conducted analyzing task execution before and after this protocol refinement was merged.

**Target Friction Category:** \`${category}\`

| Metric | Pre-Merge | Post-Merge |
|--------|-----------|------------|
| Tasks Assessed | ${preCount} | ${postCount} |
| Friction Events | ${preEvents} | ${postEvents} |
| **Friction Rate** | **${preRate.toFixed(2)}** events/task | **${postRate.toFixed(2)}** events/task |

**Impact Trend:** ${trend} (${pct})

> *Note: Pre-merge data includes tasks closed up to 14 days prior to merge. Post-merge data includes tasks closed from merge date to present.*
`;
  }
}
