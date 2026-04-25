/**
 * .agents/scripts/mcp/run-audit-suite.js — Re-export shim.
 *
 * The pure aggregation logic has moved to `.agents/scripts/run-audit-suite.js`
 * (Story #708 / Task #715). This file remains as a thin re-export so the
 * MCP tool-registry, audit-orchestrator, and existing tests keep importing
 * from the same path until the server-deletion story removes the MCP layer
 * outright (Epic #702 Story 3).
 */

export { runAuditSuite } from '../run-audit-suite.js';
