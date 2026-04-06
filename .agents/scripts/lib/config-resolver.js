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
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/ → scripts/ → .agents/ → project root
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Auto-load .env from the project root if it exists
try {
  const envPath = path.resolve(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = (match[2] || '').trim();
        // Remove quotes if present
        if (
          value.length > 0 &&
          value.charAt(0) === '"' &&
          value.charAt(value.length - 1) === '"'
        ) {
          value = value.substring(1, value.length - 1);
        } else if (
          value.length > 0 &&
          value.charAt(0) === "'" &&
          value.charAt(value.length - 1) === "'"
        ) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  }
} catch (_err) {
  // Silent fail - environment may be provided via other means
}

/** @type {string[]} Supported ticketing providers in v5. */
const _SUPPORTED_PROVIDERS = ['github'];

/** Shell metacharacter pattern for injection detection. */
const SHELL_INJECTION_RE = /([;&|`]|\$\()/;

/**
 * Embedded JSON Schema for the `orchestration` configuration block.
 * Kept inline so all config validation lives in a single file.
 *
 * @see docs/roadmap.md §A — Provider Abstraction Layer
 */
const ORCHESTRATION_SCHEMA = {
  type: 'object',
  required: ['provider'],
  properties: {
    provider: {
      type: 'string',
      enum: ['github'],
    },
    github: {
      type: 'object',
      required: ['owner', 'repo'],
      properties: {
        owner: { type: 'string', minLength: 1 },
        repo: { type: 'string', minLength: 1 },
        projectNumber: {
          type: ['integer', 'null'],
          minimum: 1,
        },
        operatorHandle: {
          type: 'string',
          pattern: '^@.+',
        },
      },
      additionalProperties: false,
    },
    executor: {
      type: 'string',
      description:
        'The execution adapter to use (e.g., "manual", "subprocess").',
    },
    notifications: {
      type: 'object',
      properties: {
        mentionOperator: { type: 'boolean' },
        webhookUrl: { type: 'string' },
      },
      additionalProperties: false,
    },
    llm: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: [
            'gemini',
            'anthropic',
            'openai',
            'anthropic-vertex',
            'azure-openai',
          ],
        },
        model: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

/** Pre-compiled ajv validator (singleton). */
let _compiledValidator = null;

function getOrchestrationValidator() {
  if (!_compiledValidator) {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    _compiledValidator = ajv.compile(ORCHESTRATION_SCHEMA);
  }
  return _compiledValidator;
}

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

    // Schema Boundary validation: Block injection metacharacters
    const schemaValidKeys = [
      'notificationWebhookUrl',
      'baseBranch',
      'validationCommand',
      'testCommand',
      'buildCommand',
      'agentRoot',
      'scriptsRoot',
      'workflowsRoot',
      'personasRoot',
      'schemasRoot',
      'docsRoot',
      'tempRoot',
      'executionTimeoutMs',
      'executionMaxBuffer',
      'lintBaselineCommand',
      'lintBaselinePath',
      'exploratoryTestCommand',
      'typecheckCommand',
    ];
    // Also validate keys nested inside verboseLogging
    if (
      settings.verboseLogging &&
      typeof settings.verboseLogging.logDir === 'string'
    ) {
      if (SHELL_INJECTION_RE.test(settings.verboseLogging.logDir)) {
        throw new Error(
          `[Security] Malicious configuration value detected in .agentrc.json under verboseLogging.logDir. ` +
            `Shell meta-characters are forbidden.`,
        );
      }
    }

    for (const key of schemaValidKeys) {
      if (
        typeof settings[key] === 'string' &&
        SHELL_INJECTION_RE.test(settings[key])
      ) {
        throw new Error(
          `[Security] Malicious configuration value detected in .agentrc.json under ${key}. ` +
            `Shell meta-characters are forbidden.`,
        );
      }
    }

    const orchestration = raw.orchestration ?? null;

    // Prioritize environment variable for the webhook URL
    const envWebhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (envWebhookUrl) {
      settings.notificationWebhookUrl = envWebhookUrl;
      if (orchestration?.notifications) {
        orchestration.notifications.webhookUrl = envWebhookUrl;
      }
    }

    _cachedConfig = { settings, orchestration, raw, source: agentrcPath };
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
      docsRoot: 'docs',
      tempRoot: 'temp',
      baseBranch: 'main',
      notificationWebhookUrl: '',
      verboseLogging: { enabled: false, logDir: 'temp/verbose-logs' },
      executionTimeoutMs: 300000, // 5 minutes
      executionMaxBuffer: 10485760, // 10MB
    },
    orchestration: null,
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
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateOrchestrationConfig(orchestration) {
  const errors = [];

  // null/undefined orchestration is valid — provider simply not configured
  if (orchestration == null) {
    return { valid: true, errors };
  }

  if (typeof orchestration !== 'object' || Array.isArray(orchestration)) {
    errors.push('orchestration must be an object.');
    return { valid: false, errors };
  }

  // --- Phase 1: JSON Schema validation via ajv ---
  const validate = getOrchestrationValidator();
  const schemaValid = validate(orchestration);

  if (!schemaValid && validate.errors) {
    for (const err of validate.errors) {
      const field = err.instancePath || '(root)';
      errors.push(`Schema: ${field} ${err.message}`);
    }
  }

  // --- Phase 2: Security checks (not expressible in JSON Schema) ---

  // GitHub-specific shell injection checks
  if (orchestration.provider === 'github' && orchestration.github) {
    const gh = orchestration.github;

    if (typeof gh.owner === 'string' && SHELL_INJECTION_RE.test(gh.owner)) {
      errors.push(
        '[Security] Shell meta-characters detected in orchestration.github.owner.',
      );
    }
    if (typeof gh.repo === 'string' && SHELL_INJECTION_RE.test(gh.repo)) {
      errors.push(
        '[Security] Shell meta-characters detected in orchestration.github.repo.',
      );
    }
    if (
      typeof gh.operatorHandle === 'string' &&
      SHELL_INJECTION_RE.test(gh.operatorHandle)
    ) {
      errors.push(
        '[Security] Shell meta-characters detected in orchestration.github.operatorHandle.',
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
        '[Security] Shell meta-characters detected in orchestration.notifications.webhookUrl.',
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
