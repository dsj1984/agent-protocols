/**
 * Unified Configuration Resolver (v4.0.0 — Universal Protocol Standardization)
 *
 * Resolution order:
 *   1. <project-root>/.agentrc.json             (new unified standard)
 *   2. <project-root>/.agents/config/config.json (legacy fallback — deprecated)
 *
 * The returned object is always a flat agentSettings hash, identical to the
 * old config.json `properties` shape, so every existing consumer script
 * continues to work without changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/ → scripts/ → .agents/ → project root
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/**
 * Extract the flat agentSettings bag from whichever config format is present.
 * @returns {{ settings: object, source: string }}
 */
export function resolveConfig() {
  // 1. Preferred: unified .agentrc.json at repo root
  const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
  if (fs.existsSync(agentrcPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(agentrcPath, 'utf8'));
      const settings = raw.agentSettings ?? {};

      // Schema Boundary validation: Block injection metacharacters
      const schemaValidKeys = ['taskStateRoot', 'goldenExamplesRoot', 'baseBranch', 'sprintDocsRoot', 'validationCommand', 'testCommand', 'buildCommand', 'agentRoot', 'scriptsRoot', 'workflowsRoot', 'personasRoot', 'keysRoot', 'schemasRoot', 'docsRoot', 'tempRoot', 'eventStreamsRoot', 'workspacesRoot'];
      for (const key of schemaValidKeys) {
        if (typeof settings[key] === 'string' && /([;&|`]|\$\()/.test(settings[key])) {
          throw new Error(`[Security] Malicious configuration value detected in .agentrc.json under ${key}. Shell meta-characters are forbidden.`);
        }
      }

      return { settings, source: agentrcPath };
    } catch {
      console.warn('[config] Failed to parse .agentrc.json — falling back to legacy config.');
    }
  }

  // 2. Legacy fallback: .agents/config/config.json
  const legacyPath = path.join(PROJECT_ROOT, '.agents/config/config.json');
  if (fs.existsSync(legacyPath)) {
    console.warn(
      '[config] DEPRECATION WARNING: .agents/config/config.json is deprecated.\n' +
      '         Copy .agents/default-agentrc.json to your project root as .agentrc.json\n' +
      '         and customise it to adopt the v4 Universal Protocol Standard.'
    );
    try {
      const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      // Legacy file uses JSON-Schema-style `properties[key].default` — flatten it.
      const settings = {};
      for (const [key, val] of Object.entries(raw.properties ?? {})) {
        settings[key] = val.default ?? val;
      }
      return { settings, source: legacyPath };
    } catch {
      console.warn('[config] Failed to parse legacy config.json — using built-in defaults.');
    }
  }

  // 3. Hard-coded defaults (zero-config experience)
  return {
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
      apcCacheSettings: { strictHashing: true, ttlDays: 30, enableSpeculativeExecution: true, cacheDir: 'temp/apc-cache' },
      securityOptions: { requireCryptographicProvenance: false },
    },
    source: 'built-in defaults',
  };
}
