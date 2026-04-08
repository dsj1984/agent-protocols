/**
 * lib/orchestration/index.js — Orchestration SDK Barrel Export
 *
 * Single entry point for the orchestration SDK. All public functions are
 * re-exported here so consumers (CLI wrappers, future MCP server) depend
 * on this module rather than reaching into internal module paths.
 *
 * @example
 *   import { dispatch } from './lib/orchestration/index.js';
 */

// Core dispatcher — business logic for orchestrating Epic task waves
export { dispatch } from './dispatcher.js';

// Context hydration — builds the execution prompt for an agent task
export { hydrateContext } from '../../context-hydrator.js';
