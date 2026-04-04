/**
 * Unified Configuration Resolver (Universal Protocol Standardization)
 *
 * Resolution order:
 *   1. <project-root>/.agentrc.json  (unified standard)
 *   2. Built-in defaults             (zero-config fallback)
 *
 * The returned object is always a flat agentSettings hash so every consumer
 * script works without changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/ → scripts/ → .agents/ → project root
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

let _cachedConfig = null;

/**
 * Extract the flat agentSettings bag from whichever config format is present.
 * Results are cached at module level to avoid redundant file I/O.
 * @param {{ bustCache?: boolean }} [opts] - Pass { bustCache: true } to force re-read.
 * @returns {{ settings: object, source: string }}
 */
export function resolveConfig(opts) {
  if (_cachedConfig && !opts?.bustCache) return _cachedConfig;
  // 1. Preferred: unified .agentrc.json at repo root
  const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
  if (fs.existsSync(agentrcPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(agentrcPath, 'utf8'));
      const settings = raw.agentSettings ?? {};

      // Schema Boundary validation: Block injection metacharacters
      const schemaValidKeys = ['taskStateRoot', 'notificationWebhookUrl', 'goldenExamplesRoot', 'baseBranch', 'sprintDocsRoot', 'validationCommand', 'testCommand', 'buildCommand', 'agentRoot', 'scriptsRoot', 'workflowsRoot', 'personasRoot', 'keysRoot', 'schemasRoot', 'docsRoot', 'tempRoot', 'eventStreamsRoot', 'workspacesRoot', 'executionTimeoutMs', 'executionMaxBuffer'];
      for (const key of schemaValidKeys) {
        if (typeof settings[key] === 'string' && /([;&|`]|\$\()/.test(settings[key])) {
          throw new Error(`[Security] Malicious configuration value detected in .agentrc.json under ${key}. Shell meta-characters are forbidden.`);
        }
      }

      _cachedConfig = { settings, source: agentrcPath };
      return _cachedConfig;
    } catch {
      console.warn('[config] Failed to parse .agentrc.json — falling back to legacy config.');
    }
  }

  // 2. Hard-coded defaults (zero-config experience)
  _cachedConfig = {
    settings: {
      agentRoot: '.agents',
      scriptsRoot: '.agents/scripts',
      workflowsRoot: '.agents/workflows',
      personasRoot: '.agents/personas',
      keysRoot: '.agents/keys',
      schemasRoot: '.agents/schemas',
      docsRoot: 'docs',
      tempRoot: 'temp',
      workspacesRoot: 'temp/workspaces',
      eventStreamsRoot: 'temp/event-streams',
      taskStateRoot: 'temp/task-state',
      goldenExamplesRoot: '.agents/golden-examples',
      maxGoldenExampleLines: 200,
      baseBranch: 'main',
      sprintDocsRoot: 'docs/sprints',
      sprintNumberPadding: 3,
      maxTokenBudget: 1000000,
      budgetWarningThreshold: 0.8,
      notificationWebhookUrl: '',
      apcCacheSettings: { strictHashing: true, ttlDays: 30, enableSpeculativeExecution: true, cacheDir: 'temp/apc-cache' },
      securityOptions: { requireCryptographicProvenance: false },
      executionTimeoutMs: 300000, // 5 minutes
      executionMaxBuffer: 10485760, // 10MB
    },
    source: 'built-in defaults',
  };
  return _cachedConfig;
}
