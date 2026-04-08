/**
 * .agents/scripts/context-hydrator.js — CLI Re-export Shim
 *
 * Thin backward-compatibility shim. The core logic has been moved to
 * `lib/orchestration/context-hydrator.js` as part of the SDK refactor.
 *
 * This file preserves backward compatibility for:
 *   - Existing tests that import hydrateContext from this path
 *   - CI/CD pipelines referencing this module path
 *   - Any consumer directly importing from scripts/
 *
 * @see lib/orchestration/context-hydrator.js — SDK module (canonical source)
 */

export {
  hydrateContext,
  parseHierarchy,
  truncateToTokenBudget,
} from './lib/orchestration/context-hydrator.js';
