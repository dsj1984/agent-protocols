/**
 * `validateOrchestrationConfig` — AJV + hand-written security checks for the
 * top-level `orchestration` block (Epic #773 Story 6 — split out of
 * config-resolver.js). The facade re-exports this symbol so consumer imports
 * resolve byte-identically.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getOrchestrationValidator,
  SHELL_INJECTION_RE_STRICT as SHELL_INJECTION_RE,
} from '../config-schema.js';
import { assertPathContainment } from '../path-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/config/ → scripts/lib/ → scripts/ → .agents/ → project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Validates the orchestration configuration block.
 *
 * Uses ajv for formal JSON Schema validation against the inline schema
 * constant, then applies additional hand-written security checks (shell
 * metacharacter injection) that are not expressible in JSON Schema.
 *
 * @param {object|null} orchestration - The raw orchestration config from .agentrc.json.
 * @throws {Error} If validation fails.
 */
export function validateOrchestrationConfig(orchestration) {
  if (orchestration == null) return;

  if (typeof orchestration !== 'object' || Array.isArray(orchestration)) {
    throw new Error(
      'Invalid orchestration configuration: orchestration must be an object.',
    );
  }

  const errors = [];

  const validate = getOrchestrationValidator();
  if (!validate(orchestration) && validate.errors) {
    for (const err of validate.errors) {
      errors.push(`- ${err.instancePath || '(root)'} ${err.message}`);
    }
  }

  // GitHub-specific shell injection checks
  if (orchestration.provider === 'github' && orchestration.github) {
    const gh = orchestration.github;
    for (const field of ['owner', 'repo', 'operatorHandle']) {
      if (typeof gh[field] === 'string' && SHELL_INJECTION_RE.test(gh[field])) {
        errors.push(
          `- [Security] Shell meta-characters detected in orchestration.github.${field}.`,
        );
      }
    }
  }

  // worktreeIsolation.root — path-traversal guard. Root is interpreted
  // relative to the repo root; resolved path must stay inside it so a hostile
  // config like "../../../etc" cannot escape.
  const wtRoot = orchestration.worktreeIsolation?.root;
  if (typeof wtRoot === 'string') {
    if (SHELL_INJECTION_RE.test(wtRoot)) {
      errors.push(
        '- [Security] Shell meta-characters detected in orchestration.worktreeIsolation.root.',
      );
    } else {
      try {
        assertPathContainment(
          PROJECT_ROOT,
          path.resolve(PROJECT_ROOT, wtRoot),
          'orchestration.worktreeIsolation.root',
          { allowEmpty: false },
        );
      } catch {
        errors.push(
          `- [Security] orchestration.worktreeIsolation.root resolves outside the repo root: ${wtRoot}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid orchestration configuration:\n${errors.join('\n')}`,
    );
  }
}
