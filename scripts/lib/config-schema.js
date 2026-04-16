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
 * @see docs/architecture.md — Provider Abstraction Layer
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
    worktreeIsolation: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        root: { type: 'string', minLength: 1 },
        nodeModulesStrategy: {
          type: 'string',
          enum: ['per-worktree', 'symlink', 'pnpm-store'],
        },
        primeFromPath: { type: ['string', 'null'], minLength: 1 },
        allowSymlinkOnWindows: { type: 'boolean' },
        reapOnSuccess: { type: 'boolean' },
        reapOnCancel: { type: 'boolean' },
        warnOnUncommittedOnReap: { type: 'boolean' },
        windowsPathLengthWarnThreshold: { type: 'integer', minimum: 1 },
        bootstrapFiles: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
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
    maxTickets: { type: 'integer', minimum: 1 },
    sprintClose: {
      type: 'object',
      properties: {
        runRetro: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  patternProperties: {
    '^(notificationWebhookUrl|baseBranch|validationCommand|testCommand|buildCommand|agentRoot|scriptsRoot|workflowsRoot|personasRoot|schemasRoot|skillsRoot|templatesRoot|rulesRoot|docsRoot|tempRoot|auditOutputDir|lintBaselineCommand|lintBaselinePath|exploratoryTestCommand|typecheckCommand)$':
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
