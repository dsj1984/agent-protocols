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

// MCP Tools - Audit execution and selection
export { runAuditSuite } from '../../mcp/run-audit-suite.js';
export { selectAudits } from '../../mcp/select-audits.js';
// Context hydration — builds the execution prompt for an agent task
export {
  hydrateContext,
  parseHierarchy,
  truncateToTokenBudget,
} from './context-hydration-engine.js';
// Core dispatcher — business logic for orchestrating Epic task waves
export { dispatch, resolveAndDispatch } from './dispatch-engine.js';
export { executeStory } from './story-executor.js';
// Ticketing operations — state transitions and hierarchy management
export {
  assertValidStructuredCommentType,
  cascadeCompletion,
  isValidStructuredCommentType,
  postStructuredComment,
  STATE_LABELS,
  STRUCTURED_COMMENT_TYPES,
  toggleTasklistCheckbox,
  transitionTicketState,
  upsertStructuredComment,
  WAVE_TYPE_PATTERN,
} from './ticketing.js';
// Wave-marker helper — canonical home for the bounded wave regex + parser.
export { parseWaveMarker, WAVE_MARKER_RE } from './wave-marker.js';
