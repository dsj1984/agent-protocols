/**
 * lib/orchestration/index.js — Orchestration SDK Barrel Export
 *
 * Single entry point for the orchestration SDK. All public functions are
 * re-exported here so consumers (CLI wrappers, future MCP server) depend
 * on this module rather than reaching into internal module paths.
 *
 * @example
 *   import { dispatch, hydrateContext } from './lib/orchestration/index.js';
 */

// Core dispatcher — business logic for orchestrating Epic task waves
export { dispatch } from './dispatcher.js';

// Context hydration — builds the execution prompt for an agent task
export {
  hydrateContext,
  parseHierarchy,
  truncateToTokenBudget,
} from './context-hydrator.js';

// Ticketing operations — state transitions and hierarchy management
export {
  STATE_LABELS,
  cascadeCompletion,
  postStructuredComment,
  toggleTasklistCheckbox,
  transitionTicketState,
} from './ticketing.js';
