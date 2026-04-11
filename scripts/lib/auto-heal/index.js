/**
 * auto-heal/index.js — Barrel Export
 *
 * Re-exports every public symbol from the auto-heal library so that consumers
 * can import from the directory rather than individual files:
 *
 *   import { resolveRiskTier, JulesAdapter } from './lib/auto-heal/index.js';
 *
 * @see auto_heal_design.md
 */

export * from './risk-resolver.js';
export * from './prompt-builder.js';
export { IAutoHealAdapter, JulesAdapter } from './adapters/jules-adapter.js';
export { GitHubIssueAdapter } from './adapters/github-issue-adapter.js';
