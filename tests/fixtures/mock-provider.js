import { ITicketingProvider } from '../../.agents/scripts/lib/ITicketingProvider.js';

/**
 * Standardized Mock Ticketing Provider for testing.
 * Supports state mutations, dependency tracking, and sub-ticket resolution.
 */
export class MockProvider extends ITicketingProvider {
  constructor({ tickets = {}, deps = {}, subTickets = {} } = {}) {
    super();
    this.tickets = tickets;
    this.deps = deps;
    this.subTickets = subTickets;
    this.updates = [];
    this.comments = [];
    this.prCalls = [];
    this.labelsEnsured = [];
    this.fieldsEnsured = [];
  }

  async getTicket(id) {
    if (!this.tickets[id]) throw new Error(`Ticket #${id} not found in mock`);
    return JSON.parse(JSON.stringify(this.tickets[id])); // Clone
  }

  async getTickets(criteria) {
    let result = Object.values(this.tickets);
    if (criteria.labels) {
      result = result.filter((t) =>
        criteria.labels.every((l) => t.labels.includes(l)),
      );
    }
    return JSON.parse(JSON.stringify(result));
  }

  async updateTicket(id, mutations) {
    this.updates.push({ id, mutations });
    const ticket = this.tickets[id];
    if (!ticket) return;

    if (mutations.labels) {
      const rm = mutations.labels.remove || [];
      const add = mutations.labels.add || [];
      let current = ticket.labels.filter((l) => !rm.includes(l));
      current = [...new Set([...current, ...add])];
      ticket.labels = current;
    }

    if (mutations.body !== undefined) {
      ticket.body = mutations.body;
    }

    if (mutations.state) {
      ticket.state = mutations.state;
    }
  }

  async postComment(id, payload) {
    this.comments.push({ id, payload });
  }

  async getRecentComments() {
    return this.comments.map((c) => ({
      issue_url: `/issues/${c.id}`,
      body: c.payload.body || c.payload,
    }));
  }

  async getTicketDependencies(id) {
    return this.deps[id] || { blocks: [], blockedBy: [] };
  }

  async getSubTickets(id) {
    const list = this.subTickets[id] || [];
    // If list is IDs, resolve. If objects, return.
    return list
      .map((item) => {
        const tid = typeof item === 'object' ? item.id : item;
        return this.tickets[tid];
      })
      .filter(Boolean);
  }

  async removeSubIssue(parentId, subIssueId) {
    if (this.subTickets[parentId]) {
      this.subTickets[parentId] = this.subTickets[parentId].filter(
        (id) => id !== subIssueId,
      );
    }
  }

  async createPullRequest(opts) {
    this.prCalls.push(opts);
    return { number: 123, url: 'https://github.com/pull/123' };
  }

  async ensureLabels(labels) {
    this.labelsEnsured.push(...labels);
  }

  async ensureProjectFields(fields) {
    this.fieldsEnsured.push(...fields);
  }

  async graphql(query, variables) {
    // Basic mock for GraphQL if needed
    return {};
  }
}
