import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/** Shell metacharacter pattern for injection detection. */
export const SHELL_INJECTION_RE = /([;&|`]|\$\()/;

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
  },
  patternProperties: {
    '^(notificationWebhookUrl|baseBranch|validationCommand|testCommand|buildCommand|agentRoot|scriptsRoot|workflowsRoot|personasRoot|schemasRoot|docsRoot|tempRoot|lintBaselineCommand|lintBaselinePath|exploratoryTestCommand|typecheckCommand|roadmapPath)$':
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
