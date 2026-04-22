import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Shell-injection pattern source (string form) used inside JSON Schema
 * `not.pattern` clauses. Kept as a string so the schema literal and the
 * regex form share one definition.
 *
 * Matches `;`, `&`, `|`, backtick, or `$(`.
 */
export const SHELL_INJECTION_PATTERN_STRING = '([;&|`]|\\$\\()';

/**
 * Regex form of the lenient shell-injection pattern for runtime string checks.
 */
export const SHELL_INJECTION_RE = new RegExp(SHELL_INJECTION_PATTERN_STRING);

/**
 * Stricter shell metacharacter pattern for orchestration runtime values
 * (owner, repo, operator handle, webhook URL) where no shell metacharacters
 * are ever legitimate.
 */
export const SHELL_INJECTION_RE_STRICT = /[&|;`<>()$]/;

/**
 * Flat agentSettings string fields. Every entry below is constrained to a
 * non-malicious string by {@link AGENT_SETTINGS_SCHEMA}. Adding a new
 * top-level string field means appending to this list, nothing else.
 */
export const AGENT_SETTINGS_STRING_FIELDS = Object.freeze([
  'baseBranch',
  'validationCommand',
  'testCommand',
  'buildCommand',
  'agentRoot',
  'scriptsRoot',
  'workflowsRoot',
  'personasRoot',
  'schemasRoot',
  'skillsRoot',
  'templatesRoot',
  'rulesRoot',
  'docsRoot',
  'tempRoot',
  'auditOutputDir',
  'lintBaselineCommand',
  'lintBaselinePath',
  'exploratoryTestCommand',
  'typecheckCommand',
]);

const STRING_FIELDS_PATTERN = `^(${AGENT_SETTINGS_STRING_FIELDS.join('|')})$`;

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
        projectName: {
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
        webhookMinLevel: {
          type: 'string',
          enum: ['progress', 'notification', 'friction', 'action'],
        },
        // Ticket-change notification controls (consumed by the in-band
        // Notifier in `lib/notifications/notifier.js`, called from
        // `transitionTicketState`). Does NOT affect the epic-runner's
        // blocker NotificationHook, which has its own lifecycle.
        level: {
          type: 'string',
          enum: ['off', 'minimal', 'default', 'verbose'],
        },
        postToEpic: { type: 'boolean' },
        channels: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['log', 'epic-comment', 'webhook'],
          },
          uniqueItems: true,
        },
      },
      additionalProperties: false,
    },
    hitl: {
      type: 'object',
      properties: {},
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
    epicRunner: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        concurrencyCap: { type: 'integer', minimum: 1 },
        pollIntervalSec: { type: 'integer', minimum: 1 },
        progressReportIntervalSec: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    planRunner: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        pollIntervalSec: { type: 'integer', minimum: 1 },
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
        logDir: {
          type: 'string',
          not: { pattern: SHELL_INJECTION_PATTERN_STRING },
        },
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
    release: {
      type: 'object',
      properties: {
        docs: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
            not: { pattern: SHELL_INJECTION_PATTERN_STRING },
          },
        },
        versionFile: {
          type: ['string', 'null'],
          not: { type: 'string', pattern: SHELL_INJECTION_PATTERN_STRING },
        },
        packageJson: { type: 'boolean' },
        autoVersionBump: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  patternProperties: {
    [STRING_FIELDS_PATTERN]: {
      type: 'string',
      not: { pattern: SHELL_INJECTION_PATTERN_STRING },
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
