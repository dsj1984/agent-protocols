import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Shell metacharacter pattern for injection detection in schema-validated
 * string fields (paths, commands). Matches `;`, `&`, `|`, backtick, or `$(`.
 */
export const SHELL_INJECTION_RE = /([;&|`]|\$\()/;

/**
 * Stricter shell metacharacter pattern for orchestration runtime values
 * (owner, repo, operator handle, webhook URL) where no shell metacharacters
 * are ever legitimate.
 */
export const SHELL_INJECTION_RE_STRICT = /[&|;`<>()$]/;

/**
 * Embedded JSON Schema for the `orchestration` configuration block.
 * Kept inline so all config validation lives in a single file.
 *
 * @see docs/roadmap.md §A — Provider Abstraction Layer
 */
export const ORCHESTRATION_SCHEMA = {
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
        projectOwner: {
          type: ['string', 'null'],
          minLength: 1,
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
  },
  additionalProperties: false,
};

/** Pre-compiled ajv validator (singleton). */
let _compiledValidator = null;

export function getOrchestrationValidator() {
  if (!_compiledValidator) {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    _compiledValidator = ajv.compile(ORCHESTRATION_SCHEMA);
  }
  return _compiledValidator;
}

export const AGENT_SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    verboseLogging: {
      type: 'object',
      properties: {
        logDir: { type: 'string', not: { pattern: '([;&|`]|\\$\\()' } },
      },
    },
    docsContextFiles: {
      type: 'array',
      items: { type: 'string' },
    },
    maintainability: {
      type: 'object',
      properties: {
        targetDirs: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
  },
  patternProperties: {
    '^(notificationWebhookUrl|baseBranch|validationCommand|testCommand|buildCommand|agentRoot|scriptsRoot|workflowsRoot|personasRoot|schemasRoot|skillsRoot|templatesRoot|rulesRoot|docsRoot|tempRoot|auditOutputDir|lintBaselineCommand|lintBaselinePath|exploratoryTestCommand|typecheckCommand|roadmapPath|retroPath)$':
      {
        type: 'string',
        not: { pattern: '([;&|`]|\\$\\()' },
      },
  },
};

let _settingsValidator = null;

export function getSettingsValidator() {
  if (!_settingsValidator) {
    const ajv = new Ajv({ allErrors: true });
    _settingsValidator = ajv.compile(AGENT_SETTINGS_SCHEMA);
  }
  return _settingsValidator;
}

/**
 * Embedded JSON Schema for the `autoHeal` configuration block.
 * Validates the consumer-defined CI self-remediation settings in `.agentrc.json`.
 *
 * @see auto_heal_design.md §New .agentrc.json Configuration Section
 */
export const AUTO_HEAL_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    adapter: { type: 'string', enum: ['jules', 'github-issue'] },
    adapters: {
      type: 'object',
      properties: {
        jules: {
          type: 'object',
          properties: {
            apiKeyEnv: { type: 'string' },
            apiUrl: { type: 'string', format: 'uri' },
            requirePlanApproval: { type: 'boolean' },
            maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
            timeoutMs: { type: 'integer', minimum: 1000 },
          },
          additionalProperties: false,
        },
        'github-issue': {
          type: 'object',
          properties: {
            labelPrefix: { type: 'string' },
            assignCopilot: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    stages: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['riskTier'],
        properties: {
          riskTier: { type: 'string', enum: ['green', 'yellow', 'red'] },
          autoApprove: { type: 'boolean' },
          logArtifact: { type: 'string' },
          allowedModifications: { type: 'array', items: { type: 'string' } },
          forbiddenModifications: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
    maxLogSizeBytes: { type: 'integer', minimum: 100 },
    branchFilter: { type: 'array', items: { type: 'string' } },
    consolidateSession: { type: 'boolean' },
  },
  additionalProperties: false,
};

/** Pre-compiled ajv validator for autoHeal config (singleton). */
let _autoHealValidator = null;

export function getAutoHealValidator() {
  if (!_autoHealValidator) {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    _autoHealValidator = ajv.compile(AUTO_HEAL_SCHEMA);
  }
  return _autoHealValidator;
}
