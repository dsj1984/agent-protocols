import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { SHELL_INJECTION_PATTERN_STRING } from './config-schema-shared.js';

// Shell-injection constants live in config-schema-shared.js so the settings
// schema file can import them without pulling this module's AJV bundle.
// Re-exported here for backward-compatible import paths.
export {
  SHELL_INJECTION_PATTERN_STRING,
  SHELL_INJECTION_RE,
  SHELL_INJECTION_RE_STRICT,
} from './config-schema-shared.js';

// The agentSettings schema lives in its own module to keep this file under
// escomplex's Halstead-volume ceiling. Re-exported here for import stability.
export {
  AGENT_SETTINGS_SCHEMA,
  AGENT_SETTINGS_STRING_FIELDS,
  getSettingsValidator,
} from './config-settings-schema.js';

/** Reusable field-level schemas to keep sub-schemas concise. */
const SAFE_STRING = {
  type: 'string',
  not: { pattern: SHELL_INJECTION_PATTERN_STRING },
};

const GITHUB_SCHEMA = {
  type: 'object',
  required: ['owner', 'repo'],
  properties: {
    owner: { type: 'string', minLength: 1 },
    repo: { type: 'string', minLength: 1 },
    projectNumber: { type: ['integer', 'null'], minimum: 1 },
    projectOwner: { type: ['string', 'null'], minLength: 1 },
    projectName: { type: ['string', 'null'], minLength: 1 },
    operatorHandle: { type: 'string', pattern: '^@.+' },
  },
  additionalProperties: false,
};

const NOTIFICATIONS_SCHEMA = {
  type: 'object',
  properties: {
    mentionOperator: { type: 'boolean' },
    webhookMinLevel: {
      type: 'string',
      enum: ['progress', 'notification', 'friction', 'action'],
    },
    // Ticket-change notification controls (consumed by the in-band Notifier
    // in `lib/notifications/notifier.js`, called from `transitionTicketState`).
    // Does NOT affect the epic-runner's blocker NotificationHook, which has
    // its own lifecycle.
    level: {
      type: 'string',
      enum: ['off', 'minimal', 'default', 'verbose'],
    },
    postToEpic: { type: 'boolean' },
    channels: {
      type: 'array',
      items: { type: 'string', enum: ['log', 'epic-comment', 'webhook'] },
      uniqueItems: true,
    },
  },
  additionalProperties: false,
};

const WORKTREE_ISOLATION_SCHEMA = {
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
};

const EPIC_RUNNER_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    concurrencyCap: { type: 'integer', minimum: 1 },
    pollIntervalSec: { type: 'integer', minimum: 1 },
    progressReportIntervalSec: { type: 'integer', minimum: 0 },
    idleTimeoutSec: { type: 'integer', minimum: 0 },
    logsDir: SAFE_STRING,
  },
  required: ['concurrencyCap'],
  additionalProperties: false,
};

const PLAN_RUNNER_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    pollIntervalSec: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
};

/**
 * Embedded JSON Schema for the `orchestration` configuration block. Kept
 * inline so all config validation lives in a single file; composed from the
 * per-section sub-schemas above.
 *
 * @see docs/architecture.md — Provider Abstraction Layer
 */
export const ORCHESTRATION_SCHEMA = {
  type: 'object',
  required: ['provider'],
  properties: {
    provider: { type: 'string', enum: ['github'] },
    github: GITHUB_SCHEMA,
    executor: {
      type: 'string',
      description:
        'The execution adapter to use (e.g., "manual", "subprocess").',
    },
    notifications: NOTIFICATIONS_SCHEMA,
    hitl: { type: 'object', properties: {}, additionalProperties: false },
    worktreeIsolation: WORKTREE_ISOLATION_SCHEMA,
    epicRunner: EPIC_RUNNER_SCHEMA,
    planRunner: PLAN_RUNNER_SCHEMA,
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
