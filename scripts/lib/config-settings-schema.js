import Ajv from 'ajv';

import { SHELL_INJECTION_PATTERN_STRING } from './config-schema-shared.js';

/**
 * Flat agentSettings string fields. Every entry below is constrained to a
 * non-malicious string by {@link AGENT_SETTINGS_SCHEMA}. Adding a new
 * top-level string field means appending to this list, nothing else.
 *
 * Command fields (validate, lintBaseline, test, typecheck, build) live under
 * `agentSettings.commands` (Epic #730 Story 5) and are NOT
 * in this list — see {@link COMMANDS_SCHEMA} below.
 */
export const AGENT_SETTINGS_STRING_FIELDS = Object.freeze([
  'baseBranch',
  'scriptsRoot',
  'workflowsRoot',
  'personasRoot',
  'schemasRoot',
  'skillsRoot',
  'templatesRoot',
  'rulesRoot',
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

/**
 * Optional commands that may be `null` to mean "disabled" but, when set as a
 * string, must be non-empty. `minLength` is a string-only keyword so it is a
 * no-op for `null`; the empty string is explicitly rejected.
 */
const NULLABLE_NONEMPTY_SAFE_STRING = {
  type: ['string', 'null'],
  minLength: 1,
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

/**
 * `quality.maintainability` carries only the per-file MI targetDirs. The
 * `crap` block was lifted out one level (it is now `quality.crap`) so the
 * grouped quality bag has a flat top-level for each enforcement engine
 * instead of CRAP being a nested concern of MI. See Epic #730 Story 6.
 */
const MAINTAINABILITY_QUALITY_SCHEMA = {
  type: 'object',
  properties: {
    targetDirs: LIST_OR_EXTENDER_OF_STRINGS,
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

/**
 * `agentSettings.limits.friction` — runtime friction-emitter thresholds
 * (renamed from the flat `agentSettings.frictionThresholds` block in
 * Epic #730 Story 8). Lives nested under {@link LIMITS_SCHEMA} alongside
 * the count/budget/timeout limits.
 */
const FRICTION_LIMITS_SCHEMA = {
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

/**
 * `quality.prGate.checks` is the configurable lint/format/test trio
 * `git-pr-quality-gate.js` runs on every `/git-merge-pr` invocation. Renamed
 * from the flat `agentSettings.qualityGate` block in Epic #730 Story 6.
 */
const PR_GATE_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
  additionalProperties: false,
};

/**
 * Per-baseline shape used inside `agentSettings.quality.baselines`. Each entry
 * carries a required on-disk `path` (the canonical baseline file the
 * lint/CRAP/MI ratchet reads + writes) and an optional `refreshCommand` that
 * lets an operator override the default `update-*-baseline.js` invocation.
 */
const BASELINE_ENTRY_SCHEMA = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { ...SAFE_STRING, minLength: 1 },
    refreshCommand: NULLABLE_NONEMPTY_SAFE_STRING,
  },
  additionalProperties: false,
};

/**
 * `agentSettings.quality` is the unified home for every enforcement engine in
 * the framework: ratchet baselines (Story 5.5), per-method MI targeting,
 * CRAP scoring, and the PR-gate command suite (Story 6). The old flat
 * `agentSettings.maintainability` and `agentSettings.qualityGate` blocks are
 * removed; consumers read via `getQuality(config)` or directly from
 * `settings.quality.*`.
 */
const QUALITY_SCHEMA = {
  type: 'object',
  properties: {
    baselines: {
      type: 'object',
      properties: {
        lint: BASELINE_ENTRY_SCHEMA,
        crap: BASELINE_ENTRY_SCHEMA,
        maintainability: BASELINE_ENTRY_SCHEMA,
      },
      additionalProperties: false,
    },
    maintainability: MAINTAINABILITY_QUALITY_SCHEMA,
    crap: MAINTAINABILITY_CRAP_SCHEMA,
    prGate: PR_GATE_SCHEMA,
  },
  additionalProperties: false,
};

/**
 * `agentSettings.limits` is the grouped home for every count/budget/timeout
 * runtime ceiling (Epic #730 Story 8). The legacy flat
 * `maxInstructionSteps` / `maxTickets` / `maxTokenBudget` /
 * `executionTimeoutMs` / `executionMaxBuffer` keys move under here; the
 * `frictionThresholds` block becomes `limits.friction`.
 */
const LIMITS_SCHEMA = {
  type: 'object',
  properties: {
    maxInstructionSteps: { type: 'integer', minimum: 1 },
    maxTickets: { type: 'integer', minimum: 1 },
    maxTokenBudget: { type: 'integer', minimum: 1 },
    executionTimeoutMs: { type: 'integer', minimum: 1 },
    executionMaxBuffer: { type: 'integer', minimum: 1 },
    friction: FRICTION_LIMITS_SCHEMA,
  },
  additionalProperties: false,
};

/**
 * `agentSettings.paths` is the grouped home for the framework's filesystem
 * roots (Epic #730 Story 7). `agentRoot` / `docsRoot` / `tempRoot` are
 * hard-required (transferred from the agentSettings-level Story 4 contract);
 * `auditOutputDir` is optional with a `'temp'` default applied by
 * {@link getPaths} in the resolver. additionalProperties: false catches
 * misspelled keys up front.
 */
const PATHS_SCHEMA = {
  type: 'object',
  required: ['agentRoot', 'docsRoot', 'tempRoot'],
  properties: {
    agentRoot: { ...SAFE_STRING, minLength: 1 },
    docsRoot: { ...SAFE_STRING, minLength: 1 },
    tempRoot: { ...SAFE_STRING, minLength: 1 },
    auditOutputDir: { ...SAFE_STRING, minLength: 1 },
  },
  additionalProperties: false,
};

/**
 * Grouped command fields. `typecheck` and `build` accept `null` to mean
 * "disabled" (Story 3 `null`-for-disabled convention); the others are
 * required-when-present non-empty strings. `additionalProperties: false`
 * so a misspelled command key fails validation up front.
 */
export const COMMANDS_SCHEMA = {
  type: 'object',
  properties: {
    validate: { ...SAFE_STRING, minLength: 1 },
    lintBaseline: { ...SAFE_STRING, minLength: 1 },
    test: { ...SAFE_STRING, minLength: 1 },
    typecheck: NULLABLE_NONEMPTY_SAFE_STRING,
    build: NULLABLE_NONEMPTY_SAFE_STRING,
  },
  additionalProperties: false,
};

export const AGENT_SETTINGS_SCHEMA = {
  type: 'object',
  // The hard-required path roots (`agentRoot` / `docsRoot` / `tempRoot`)
  // moved under `paths` in Epic #730 Story 7 — see PATHS_SCHEMA.required.
  // The agentSettings-level `paths` block itself is required so a config
  // that omits the entire group still fails fast with a clear message.
  required: ['paths'],
  properties: {
    docsContextFiles: { type: 'array', items: { type: 'string' } },
    sprintClose: SPRINT_CLOSE_SCHEMA,
    release: RELEASE_SCHEMA,
    riskGates: RISK_GATES_SCHEMA,
    quality: QUALITY_SCHEMA,
    commands: COMMANDS_SCHEMA,
    paths: PATHS_SCHEMA,
    limits: LIMITS_SCHEMA,
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
