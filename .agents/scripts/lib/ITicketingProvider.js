/**
 * ITicketingProvider — Abstract Ticketing Provider Interface
 *
 * All ticketing interactions in the v5 Epic-centric orchestration are mediated
 * through this interface. Concrete implementations (e.g., `providers/github.js`)
 * extend this class and override every method.
 *
 * Unoverridden methods throw `Error('Not implemented: <method>')` to enforce
 * the contract at runtime rather than silently returning `undefined`.
 *
 * @see docs/roadmap.md §A — Provider Abstraction Layer
 * @see docs/v5-implementation-plan.md Sprint 1A
 */

export class ITicketingProvider {
  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  /**
   * Fetch the Epic issue with body and linked context issues (PRD, Tech Spec).
   *
   * @param {number} epicId - GitHub Issue number of the Epic.
   * @returns {Promise<{
   *   id: number,
   *   title: string,
   *   body: string,
   *   labels: string[],
   *   linkedIssues: { prd: number|null, techSpec: number|null }
   * }>}
   */
  async getEpic(epicId) {
    throw new Error('Not implemented: getEpic');
  }

  /**
   * Fetch all child tickets for an Epic, optionally filtered by labels or state.
   *
   * @param {number} epicId - GitHub Issue number of the Epic.
   * @param {{ label?: string, state?: string }} [filters={}] - Filter criteria.
   * @returns {Promise<Array<{
   *   id: number,
   *   title: string,
   *   labels: string[],
   *   state: string
   * }>>}
   */
  async getTickets(epicId, filters = {}) {
    throw new Error('Not implemented: getTickets');
  }

  /**
   * Retrieve a single ticket with full metadata.
   *
   * @param {number} ticketId - GitHub Issue number.
   * @returns {Promise<{
   *   id: number,
   *   title: string,
   *   body: string,
   *   labels: string[],
   *   assignees: string[],
   *   state: string
   * }>}
   */
  async getTicket(ticketId) {
    throw new Error('Not implemented: getTicket');
  }

  /**
   * Return the dependency graph edges for a ticket.
   * Parses `blocked by #NNN` patterns from the ticket body.
   *
   * @param {number} ticketId - GitHub Issue number.
   * @returns {Promise<{
   *   blocks: number[],
   *   blockedBy: number[]
   * }>}
   */
  async getTicketDependencies(ticketId) {
    throw new Error('Not implemented: getTicketDependencies');
  }

  // ---------------------------------------------------------------------------
  // Write Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a child ticket under an Epic.
   *
   * @param {number} epicId - GitHub Issue number of the parent Epic.
   * @param {{
   *   title: string,
   *   body: string,
   *   labels: string[],
   *   dependencies: number[]
   * }} ticketData - The ticket content and metadata.
   * @returns {Promise<{ id: number, url: string }>}
   */
  async createTicket(epicId, ticketData) {
    throw new Error('Not implemented: createTicket');
  }

  /**
   * Link an existing issue as a sub-issue of a parent.
   *
   * @param {number} parentId - GitHub Issue number of the parent.
   * @param {number} childId - GitHub Issue number of the sub-issue.
   * @returns {Promise<void>}
   */
  async addSubIssue(parentId, childId) {
    throw new Error('Not implemented: addSubIssue');
  }

  /**
   * Mutate labels, body (tasklist checkboxes), and assignees on a ticket.
   *
   * @param {number} ticketId - GitHub Issue number.
   * @param {{
   *   labels?: { add?: string[], remove?: string[] },
   *   body?: string,
   *   assignees?: string[]
   * }} mutations - The mutations to apply.
   * @returns {Promise<void>}
   */
  async updateTicket(ticketId, mutations) {
    throw new Error('Not implemented: updateTicket');
  }

  /**
   * Append a structured comment to a ticket.
   *
   * @param {number} ticketId - GitHub Issue number.
   * @param {{
   *   body: string,
   *   type: 'progress'|'friction'|'notification'
   * }} payload - The comment content and classification.
   * @returns {Promise<{ commentId: number }>}
   */
  async postComment(ticketId, payload) {
    throw new Error('Not implemented: postComment');
  }

  /**
   * Open a Pull Request linking the specified ticket.
   *
   * @param {string} branchName - The source branch for the PR.
   * @param {number} ticketId - GitHub Issue number to link.
   * @returns {Promise<{ number: number, url: string, htmlUrl: string }>}
   */
  async createPullRequest(branchName, ticketId) {
    throw new Error('Not implemented: createPullRequest');
  }

  // ---------------------------------------------------------------------------
  // Setup Operations (used by bootstrap)
  // ---------------------------------------------------------------------------

  /**
   * Idempotent label creation. Skips labels that already exist.
   *
   * @param {Array<{ name: string, color: string, description: string }>} labelDefs
   * @returns {Promise<{ created: string[], skipped: string[] }>}
   */
  async ensureLabels(labelDefs) {
    throw new Error('Not implemented: ensureLabels');
  }

  /**
   * Idempotent custom field creation on the Project board.
   * Only applicable when `projectNumber` is configured.
   *
   * @param {Array<{
   *   name: string,
   *   type: 'iteration'|'single_select',
   *   options?: string[]
   * }>} fieldDefs
   * @returns {Promise<{ created: string[], skipped: string[] }>}
   */
  async ensureProjectFields(fieldDefs) {
    throw new Error('Not implemented: ensureProjectFields');
  }
}
