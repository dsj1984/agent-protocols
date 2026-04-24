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
  getAuditsValidator,
  getOrchestrationValidator,
  getSettingsValidator,
  SHELL_INJECTION_RE_STRICT as SHELL_INJECTION_RE,
} from './config-schema.js';
import { loadEnv } from './env-loader.js';
import { assertPathContainment } from './path-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/ → scripts/ → .agents/ → project root
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Cache keyed by absolute root path so callers passing different cwds
// (e.g. per-worktree) each get their own resolved config.
const _cacheByRoot = new Map();
const _envLoadedRoots = new Set();

/**
 * Defaults applied to a loaded .agentrc.json. Narrower than the zero-config
 * set: fields intentionally omitted here (e.g. baseBranch) remain undefined
 * unless the operator set them explicitly in the config file.
 */
const LOADED_CONFIG_DEFAULTS = Object.freeze({
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
  auditOutputDir: 'temp',
  maxTickets: 40,
  executionTimeoutMs: 300000,
  executionMaxBuffer: 10485760,
  maxTokenBudget: 200000,
});

/** Richer defaults for the zero-config (no .agentrc.json present) path. */
const ZERO_CONFIG_DEFAULTS = Object.freeze({
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
  maxTickets: 40,
  executionTimeoutMs: 300000, // 5 minutes
  executionMaxBuffer: 10485760, // 10MB
  maxTokenBudget: 200000, // 200k tokens — fits modern Claude/GPT windows
});

/** Framework defaults for `agentSettings.maintainability.crap`. Applied to the
 * loaded config via {@link resolveMaintainability} so a consumer repo that
 * omits the block (or any key within it) still gets sane defaults. Exported
 * for tests and for consumers that want to introspect the canonical shape. */
export const MAINTAINABILITY_CRAP_DEFAULTS = Object.freeze({
  enabled: true,
  targetDirs: Object.freeze(['.agents/scripts']),
  newMethodCeiling: 30,
  coveragePath: 'coverage/coverage-final.json',
  tolerance: 0.001,
  requireCoverage: true,
  friction: Object.freeze({ markerKey: 'crap-baseline-regression' }),
  refreshTag: 'baseline-refresh:',
});

/** Recognized keys for `maintainability.crap`. Used by the resolver to warn
 * (not fail) on unknown keys per AC19. */
const MAINTAINABILITY_CRAP_KEYS = new Set(
  Object.keys(MAINTAINABILITY_CRAP_DEFAULTS),
);

/**
 * Deep-merge a list-valued config key with its framework default.
 *
 * Accepts:
 *   - `undefined`           → return a copy of `defaultList`
 *   - plain array           → replace wholesale (returns a copy)
 *   - `{ append, prepend }` → extend `defaultList`; items already present in
 *                             the result are deduped so a consumer appending
 *                             a framework entry does not produce a duplicate.
 *
 * @param {readonly string[]} defaultList
 * @param {unknown} userValue
 * @returns {string[]}
 */
export function resolveListValue(defaultList, userValue) {
  if (userValue === undefined) return [...defaultList];
  if (Array.isArray(userValue)) return [...userValue];
  if (userValue !== null && typeof userValue === 'object') {
    const result = [];
    const seen = new Set();
    const push = (item) => {
      if (!seen.has(item)) {
        result.push(item);
        seen.add(item);
      }
    };
    if (Array.isArray(userValue.prepend)) {
      for (const item of userValue.prepend) push(item);
    }
    for (const item of defaultList) push(item);
    if (Array.isArray(userValue.append)) {
      for (const item of userValue.append) push(item);
    }
    return result;
  }
  return [...defaultList];
}

/**
 * Merge a user-supplied `maintainability.crap` block with framework defaults.
 * Scalar keys replace; `targetDirs` supports the list-extender shape; unknown
 * keys emit a `console.warn` but do not fail resolution (AC19).
 *
 * @param {object|undefined} userCrap
 * @returns {object}
 */
export function resolveMaintainabilityCrap(userCrap) {
  const defaults = MAINTAINABILITY_CRAP_DEFAULTS;
  if (userCrap == null || typeof userCrap !== 'object') {
    return {
      enabled: defaults.enabled,
      targetDirs: [...defaults.targetDirs],
      newMethodCeiling: defaults.newMethodCeiling,
      coveragePath: defaults.coveragePath,
      tolerance: defaults.tolerance,
      requireCoverage: defaults.requireCoverage,
      friction: { ...defaults.friction },
      refreshTag: defaults.refreshTag,
    };
  }

  for (const key of Object.keys(userCrap)) {
    if (!MAINTAINABILITY_CRAP_KEYS.has(key)) {
      console.warn(
        `[config] Unknown key 'maintainability.crap.${key}' — ignoring.`,
      );
    }
  }

  return {
    enabled: userCrap.enabled ?? defaults.enabled,
    targetDirs: resolveListValue(defaults.targetDirs, userCrap.targetDirs),
    newMethodCeiling: userCrap.newMethodCeiling ?? defaults.newMethodCeiling,
    coveragePath: userCrap.coveragePath ?? defaults.coveragePath,
    tolerance: userCrap.tolerance ?? defaults.tolerance,
    requireCoverage: userCrap.requireCoverage ?? defaults.requireCoverage,
    friction: { ...defaults.friction, ...(userCrap.friction ?? {}) },
    refreshTag: userCrap.refreshTag ?? defaults.refreshTag,
  };
}

/**
 * Merge a user-supplied `maintainability` block with framework defaults,
 * including list-extender support for `targetDirs` and full resolution of
 * the nested `crap` sub-block.
 *
 * @param {object|undefined} userBlock
 * @returns {object}
 */
export function resolveMaintainability(userBlock) {
  const defaultTargetDirs = LOADED_CONFIG_DEFAULTS.maintainability.targetDirs;
  if (userBlock == null || typeof userBlock !== 'object') {
    return {
      targetDirs: [...defaultTargetDirs],
      crap: resolveMaintainabilityCrap(undefined),
    };
  }
  return {
    targetDirs: resolveListValue(defaultTargetDirs, userBlock.targetDirs),
    crap: resolveMaintainabilityCrap(userBlock.crap),
  };
}

/** Keys to apply on top of a loaded config when the operator omitted them.
 * Matches the previous hand-rolled assignment block exactly so behavior is
 * unchanged: keys not in LOADED_CONFIG_DEFAULTS resolve to `undefined`. */
const LOADED_CONFIG_APPLY_KEYS = [
  'agentRoot',
  'scriptsRoot',
  'workflowsRoot',
  'personasRoot',
  'schemasRoot',
  'skillsRoot',
  'templatesRoot',
  'rulesRoot',
  'docsRoot',
  'docsContextFiles',
  'maintainability',
  'tempRoot',
  'auditOutputDir',
  'baseBranch',
  'executionTimeoutMs',
  'executionMaxBuffer',
  'maxTokenBudget',
];

/**
 * Extract the flat agentSettings bag from whichever config format is present.
 * Results are cached per resolved root path to avoid redundant file I/O.
 *
 * Error policy:
 *   - File missing (ENOENT) → fall through to built-in defaults (zero-config).
 *   - File present but malformed JSON → throw immediately (config corruption is
 *     a fatal error, not a silent fallback scenario).
 *
 * @param {{ bustCache?: boolean, cwd?: string, validate?: boolean, ctx?: object }} [opts]
 *   - `cwd`: absolute path to the directory whose `.agentrc.json` should be
 *     loaded. Defaults to the framework's `PROJECT_ROOT`. Worktree-mode
 *     callers pass the worktree path so each worktree resolves its own config.
 *   - `bustCache`: force re-read for the resolved root.
 *   - `validate`: when `false`, skip `validateOrchestrationConfig()`. Default
 *     `true`. Only unit tests that feed deliberately-malformed configs should
 *     opt out; production callers must leave it on so a broken orchestration
 *     block fails loudly at load time instead of mid-run.
 *   - `ctx`: runtime context from `lib/runtime-context.js`. When provided,
 *     `ctx.fs` is used for `.agentrc.json` I/O instead of the module-level
 *     `node:fs`. The default continues to use real `node:fs` so existing
 *     callers keep working unchanged.
 * @returns {{ settings: object, orchestration: object|null, raw: object|null, source: string }}
 */
export function resolveConfig(opts) {
  // Test-only override: `AP_AGENTRC_CWD` lets fixture tests point launcher
  // subprocesses at a temp dir holding a synthetic `.agentrc.json`, without
  // disk-swapping the real project config and racing against parallel tests.
  const envCwd = process.env.AP_AGENTRC_CWD;
  const root = path.resolve(opts?.cwd ?? envCwd ?? PROJECT_ROOT);
  const validate = opts?.validate !== false;
  const fsImpl = opts?.ctx?.fs ?? fs;

  if (!opts?.bustCache && _cacheByRoot.has(root)) {
    return _cacheByRoot.get(root);
  }

  // Lazy .env load: deferred from module scope so importing this module
  // never mutates process.env as a side effect. Loaded once per root.
  if (!_envLoadedRoots.has(root)) {
    loadEnv(root);
    _envLoadedRoots.add(root);
  }

  // 1. Preferred: unified .agentrc.json at the resolved root
  const agentrcPath = path.join(root, '.agentrc.json');
  if (fsImpl.existsSync(agentrcPath)) {
    let raw;
    try {
      raw = JSON.parse(fsImpl.readFileSync(agentrcPath, 'utf8'));
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
    const audits = raw.audits ?? null;

    // Apply defaults to the loaded config. Missing keys that are also absent
    // from LOADED_CONFIG_DEFAULTS (e.g. schemasRoot, docsRoot, tempRoot,
    // baseBranch) resolve to `undefined`, preserving the long-standing
    // zero-config/loaded-config asymmetry rather than silently promoting the
    // richer zero-config set.
    for (const key of LOADED_CONFIG_APPLY_KEYS) {
      settings[key] = settings[key] ?? LOADED_CONFIG_DEFAULTS[key];
    }

    // Deep-merge maintainability (list-extender on targetDirs, nested crap
    // defaults) rather than taking the user block as-is.
    settings.maintainability = resolveMaintainability(settings.maintainability);

    if (validate) {
      validateOrchestrationConfig(orchestration);
      validateAuditsConfig(audits);
    }

    const resolved = {
      settings,
      orchestration,
      audits,
      raw,
      source: agentrcPath,
    };
    _cacheByRoot.set(root, resolved);
    return resolved;
  }

  // 2. Hard-coded defaults (zero-config experience)
  const zeroSettings = { ...ZERO_CONFIG_DEFAULTS };
  zeroSettings.maintainability = resolveMaintainability(
    zeroSettings.maintainability,
  );
  const resolved = {
    settings: zeroSettings,
    orchestration: null,
    audits: null,
    raw: null,
    source: 'built-in defaults',
  };
  _cacheByRoot.set(root, resolved);
  return resolved;
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

  // worktreeIsolation.root — path-traversal guard.
  // The root is interpreted relative to the repo root; resolved path must stay
  // inside it so a hostile config like "../../../etc" cannot escape.
  if (orchestration.worktreeIsolation?.root != null) {
    const root = orchestration.worktreeIsolation.root;
    if (typeof root === 'string') {
      if (SHELL_INJECTION_RE.test(root)) {
        errors.push(
          '- [Security] Shell meta-characters detected in orchestration.worktreeIsolation.root.',
        );
      } else {
        try {
          assertPathContainment(
            PROJECT_ROOT,
            path.resolve(PROJECT_ROOT, root),
            'orchestration.worktreeIsolation.root',
            { allowEmpty: false },
          );
        } catch {
          errors.push(
            `- [Security] orchestration.worktreeIsolation.root resolves outside the repo root: ${root}`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid orchestration configuration:\n${errors.join('\n')}`,
    );
  }
}

/**
 * Validates the top-level `audits` configuration block. Null/undefined is
 * treated as "unset" — consumers fall through to their own defaults.
 *
 * @param {object|null} audits
 * @throws {Error} If schema validation fails.
 */
export function validateAuditsConfig(audits) {
  if (audits == null) return;

  if (typeof audits !== 'object' || Array.isArray(audits)) {
    throw new Error('Invalid audits configuration: audits must be an object.');
  }

  const validate = getAuditsValidator();
  if (!validate(audits)) {
    const details = (validate.errors ?? [])
      .map((e) => `- ${e.instancePath || '(root)'} ${e.message}`)
      .join('\n');
    throw new Error(`Invalid audits configuration:\n${details}`);
  }
}
