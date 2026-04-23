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

const MAINTAINABILITY_SCHEMA = {
  type: 'object',
  properties: {
    targetDirs: { type: 'array', items: { type: 'string' } },
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

export const AGENT_SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    docsContextFiles: { type: 'array', items: { type: 'string' } },
    maintainability: MAINTAINABILITY_SCHEMA,
    maxTickets: { type: 'integer', minimum: 1 },
    sprintClose: SPRINT_CLOSE_SCHEMA,
    release: RELEASE_SCHEMA,
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
