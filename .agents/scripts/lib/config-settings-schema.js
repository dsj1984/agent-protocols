import Ajv from 'ajv';

import { SHELL_INJECTION_PATTERN_STRING } from './config-schema-shared.js';

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

const SAFE_STRING = {
  type: 'string',
  not: { pattern: SHELL_INJECTION_PATTERN_STRING },
};

const NULLABLE_SAFE_STRING = {
  type: ['string', 'null'],
  not: { type: 'string', pattern: SHELL_INJECTION_PATTERN_STRING },
};

/** A list-valued config key may be a plain array (replace) or an extender
 * object `{ append, prepend }` that deep-merges with framework defaults. */
const LIST_OR_EXTENDER_OF_STRINGS = {
  oneOf: [
    { type: 'array', items: { type: 'string' } },
    {
      type: 'object',
      properties: {
        append: { type: 'array', items: { type: 'string' } },
        prepend: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  ],
};

const MAINTAINABILITY_CRAP_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    targetDirs: LIST_OR_EXTENDER_OF_STRINGS,
    newMethodCeiling: { type: 'integer', minimum: 1 },
    coveragePath: { ...SAFE_STRING, minLength: 1 },
    tolerance: { type: 'number', minimum: 0 },
    requireCoverage: { type: 'boolean' },
    friction: {
      type: 'object',
      properties: { markerKey: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
    refreshTag: { ...SAFE_STRING, minLength: 1 },
  },
  // `coveragePath` is required only when the user has explicitly opted into
  // coverage enforcement (`enabled: true` AND `requireCoverage: true`). Either
  // flag absent/false leaves the path optional so disabled crap blocks and
  // coverage-relaxed configs both validate without ceremony.
  allOf: [
    {
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then keyword
      if: {
        properties: {
          enabled: { const: true },
          requireCoverage: { const: true },
        },
        required: ['enabled', 'requireCoverage'],
      },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then keyword
      then: { required: ['coveragePath'] },
    },
  ],
  // No `additionalProperties: false` — unknown keys warn at resolver time
  // (AC19) rather than failing validation.
};

const MAINTAINABILITY_SCHEMA = {
  type: 'object',
  properties: {
    targetDirs: LIST_OR_EXTENDER_OF_STRINGS,
    crap: MAINTAINABILITY_CRAP_SCHEMA,
  },
  additionalProperties: false,
};

const SPRINT_CLOSE_SCHEMA = {
  type: 'object',
  properties: {
    runRetro: { type: 'boolean' },
  },
  additionalProperties: false,
};

const RELEASE_SCHEMA = {
  type: 'object',
  properties: {
    docs: {
      type: 'array',
      items: { ...SAFE_STRING, minLength: 1 },
    },
    versionFile: NULLABLE_SAFE_STRING,
    packageJson: { type: 'boolean' },
    autoVersionBump: { type: 'boolean' },
  },
  additionalProperties: false,
};

const FRICTION_THRESHOLDS_SCHEMA = {
  type: 'object',
  properties: {
    repetitiveCommandCount: { type: 'integer', minimum: 1 },
    consecutiveErrorCount: { type: 'integer', minimum: 1 },
    stagnationStepCount: { type: 'integer', minimum: 1 },
    maxIntegrationRetries: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
};

const RISK_GATES_SCHEMA = {
  type: 'object',
  properties: {
    heuristics: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
  additionalProperties: false,
};

const QUALITY_GATE_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
  additionalProperties: false,
};

export const AGENT_SETTINGS_SCHEMA = {
  type: 'object',
  // `agentRoot`, `docsRoot`, `tempRoot` are hard-required. Resolver fallbacks
  // for these were removed in Epic #730 Story 4 — every config must declare
  // them explicitly so a missing key surfaces as an actionable schema error
  // instead of a silent default.
  required: ['agentRoot', 'docsRoot', 'tempRoot'],
  properties: {
    docsContextFiles: { type: 'array', items: { type: 'string' } },
    maintainability: MAINTAINABILITY_SCHEMA,
    maxTickets: { type: 'integer', minimum: 1 },
    maxInstructionSteps: { type: 'integer', minimum: 1 },
    maxTokenBudget: { type: 'integer', minimum: 1 },
    executionTimeoutMs: { type: 'integer', minimum: 1 },
    executionMaxBuffer: { type: 'integer', minimum: 1 },
    sprintClose: SPRINT_CLOSE_SCHEMA,
    release: RELEASE_SCHEMA,
    frictionThresholds: FRICTION_THRESHOLDS_SCHEMA,
    riskGates: RISK_GATES_SCHEMA,
    qualityGate: QUALITY_GATE_SCHEMA,
  },
  patternProperties: {
    [STRING_FIELDS_PATTERN]: SAFE_STRING,
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
