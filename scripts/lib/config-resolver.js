/**
 * Unified Configuration Resolver (Universal Protocol Standardization)
 *
 * Resolution order:
 *   1. <project-root>/.agentrc.json  (unified standard)
 *   2. Built-in defaults             (zero-config fallback)
 *
 * The returned object is always a flat agentSettings hash so every consumer
 * script works without changes. The `orchestration` block (v5) is exposed
 * as a separate top-level property for ticketing provider resolution.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getOrchestrationValidator,
  getSettingsValidator,
} from './config-schema.js';
import { loadEnv } from './env-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/ → scripts/ → .agents/ → project root
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const SHELL_INJECTION_RE = /[&|;`<>()$]/;

// Auto-load .env from the project root if it exists
loadEnv(PROJECT_ROOT);

let _cachedConfig = null;

/**
 * Extract the flat agentSettings bag from whichever config format is present.
 * Results are cached at module level to avoid redundant file I/O.
 *
 * Error policy:
 *   - File missing (ENOENT) → fall through to built-in defaults (zero-config).
 *   - File present but malformed JSON → throw immediately (config corruption is
 *     a fatal error, not a silent fallback scenario).
 *
 * @param {{ bustCache?: boolean }} [opts] - Pass { bustCache: true } to force re-read.
 * @returns {{ settings: object, orchestration: object|null, raw: object|null, source: string }}
 */
export function resolveConfig(opts) {
  if (_cachedConfig && !opts?.bustCache) return _cachedConfig;

  // 1. Preferred: unified .agentrc.json at repo root
  const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
  if (fs.existsSync(agentrcPath)) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(agentrcPath, 'utf8'));
    } catch (parseErr) {
      // File exists but is not valid JSON — this is always a fatal config error.
      throw new Error(
        `[config] Failed to parse .agentrc.json: ${parseErr.message}. ` +
          `Fix the JSON syntax before proceeding.`,
      );
    }

    const settings = raw.agentSettings ?? {};

    const validateSettings = getSettingsValidator();
    if (!validateSettings(settings)) {
      const details = validateSettings.errors
        .map((e) => `${e.instancePath} ${e.message}`)
        .join(', ');
      throw new Error(
        `[Security] Malicious configuration value detected in .agentrc.json. ` +
          `Shell meta-characters are forbidden. Details: ${details}`,
      );
    }

    const orchestration = raw.orchestration ?? null;

    const autoHealRaw = raw.autoHeal ?? null;
    // Apply defaults for the autoHeal block when present.
    const autoHeal = autoHealRaw
      ? {
          enabled: true,
          adapter: 'jules',
          maxLogSizeBytes: 4000,
          branchFilter: ['main'],
          consolidateSession: true,
          ...autoHealRaw,
          adapters: autoHealRaw.adapters ?? {},
          stages: autoHealRaw.stages ?? {},
        }
      : null;

    const defaults = {
      agentRoot: '.agents',
      scriptsRoot: '.agents/scripts',
      workflowsRoot: '.agents/workflows',
      personasRoot: '.agents/personas',
      skillsRoot: '.agents/skills',
      templatesRoot: '.agents/templates',
      rulesRoot: '.agents/rules',
      docsContextFiles: [
        'architecture.md',
        'data-dictionary.md',
        'decisions.md',
        'patterns.md',
      ],
      maintainability: { targetDirs: ['.agents/scripts', 'tests'] },
      roadmapPath: 'docs/ROADMAP.md',
      executionTimeoutMs: 300000,
      executionMaxBuffer: 10485760,
      maxTokenBudget: 80000,
    };

    // Apply defaults to the loaded config
    settings.agentRoot = settings.agentRoot ?? defaults.agentRoot;
    settings.scriptsRoot = settings.scriptsRoot ?? defaults.scriptsRoot;
    settings.workflowsRoot = settings.workflowsRoot ?? defaults.workflowsRoot;
    settings.personasRoot = settings.personasRoot ?? defaults.personasRoot;
    settings.schemasRoot = settings.schemasRoot ?? defaults.schemasRoot;
    settings.skillsRoot = settings.skillsRoot ?? defaults.skillsRoot;
    settings.templatesRoot = settings.templatesRoot ?? defaults.templatesRoot;
    settings.rulesRoot = settings.rulesRoot ?? defaults.rulesRoot;
    settings.docsRoot = settings.docsRoot ?? defaults.docsRoot;
    settings.docsContextFiles =
      settings.docsContextFiles ?? defaults.docsContextFiles;
    settings.maintainability =
      settings.maintainability ?? defaults.maintainability;
    settings.tempRoot = settings.tempRoot ?? defaults.tempRoot;
    settings.baseBranch = settings.baseBranch ?? defaults.baseBranch;
    settings.notificationWebhookUrl =
      settings.notificationWebhookUrl ?? defaults.notificationWebhookUrl;
    settings.verboseLogging =
      settings.verboseLogging ?? defaults.verboseLogging;
    settings.roadmapPath = settings.roadmapPath ?? defaults.roadmapPath;
    settings.executionTimeoutMs =
      settings.executionTimeoutMs ?? defaults.executionTimeoutMs;
    settings.executionMaxBuffer =
      settings.executionMaxBuffer ?? defaults.executionMaxBuffer;
    settings.maxTokenBudget =
      settings.maxTokenBudget ?? defaults.maxTokenBudget;

    // Prioritize environment variable for the webhook URL
    const envWebhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (envWebhookUrl) {
      settings.notificationWebhookUrl = envWebhookUrl;
      if (orchestration?.notifications) {
        orchestration.notifications.webhookUrl = envWebhookUrl;
      }
    }

    _cachedConfig = {
      settings,
      orchestration,
      autoHeal,
      raw,
      source: agentrcPath,
    };
    return _cachedConfig;
  }

  // 2. Hard-coded defaults (zero-config experience)
  _cachedConfig = {
    settings: {
      agentRoot: '.agents',
      scriptsRoot: '.agents/scripts',
      workflowsRoot: '.agents/workflows',
      personasRoot: '.agents/personas',
      schemasRoot: '.agents/schemas',
      skillsRoot: '.agents/skills',
      templatesRoot: '.agents/templates',
      rulesRoot: '.agents/rules',
      docsRoot: 'docs',
      docsContextFiles: [
        'architecture.md',
        'data-dictionary.md',
        'decisions.md',
        'patterns.md',
      ],
      maintainability: { targetDirs: ['.agents/scripts', 'tests'] },
      tempRoot: 'temp',
      baseBranch: 'main',
      notificationWebhookUrl: '',
      verboseLogging: { enabled: false, logDir: 'temp/verbose-logs' },
      roadmapPath: 'docs/ROADMAP.md',
      executionTimeoutMs: 300000, // 5 minutes
      executionMaxBuffer: 10485760, // 10MB
      maxTokenBudget: 80000, // Default 80k token budget
    },
    orchestration: null,
    autoHeal: null,
    raw: null,
    source: 'built-in defaults',
  };
  return _cachedConfig;
}

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
  // null/undefined orchestration is valid — provider simply not configured
  if (orchestration == null) {
    return;
  }

  if (typeof orchestration !== 'object' || Array.isArray(orchestration)) {
    throw new Error(
      'Invalid orchestration configuration: orchestration must be an object.',
    );
  }

  const errors = [];

  // --- Phase 1: JSON Schema validation via ajv ---
  const validate = getOrchestrationValidator();
  const schemaValid = validate(orchestration);

  if (!schemaValid && validate.errors) {
    for (const err of validate.errors) {
      const field = err.instancePath || '(root)';
      errors.push(`- ${field} ${err.message}`);
    }
  }

  // --- Phase 2: Security checks (not expressible in JSON Schema) ---

  // GitHub-specific shell injection checks
  if (orchestration.provider === 'github' && orchestration.github) {
    const gh = orchestration.github;

    if (typeof gh.owner === 'string' && SHELL_INJECTION_RE.test(gh.owner)) {
      errors.push(
        '- [Security] Shell meta-characters detected in orchestration.github.owner.',
      );
    }
    if (typeof gh.repo === 'string' && SHELL_INJECTION_RE.test(gh.repo)) {
      errors.push(
        '- [Security] Shell meta-characters detected in orchestration.github.repo.',
      );
    }
    if (
      typeof gh.operatorHandle === 'string' &&
      SHELL_INJECTION_RE.test(gh.operatorHandle)
    ) {
      errors.push(
        '- [Security] Shell meta-characters detected in orchestration.github.operatorHandle.',
      );
    }
  }

  // Notification webhook injection check
  if (orchestration.notifications?.webhookUrl) {
    if (
      typeof orchestration.notifications.webhookUrl === 'string' &&
      SHELL_INJECTION_RE.test(orchestration.notifications.webhookUrl)
    ) {
      errors.push(
        '- [Security] Shell meta-characters detected in orchestration.notifications.webhookUrl.',
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid orchestration configuration:\n${errors.join('\n')}`,
    );
  }
}
