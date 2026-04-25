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

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
 *
 * The path roots (`agentRoot` / `docsRoot` / `tempRoot` / `auditOutputDir`)
 * are intentionally absent — they live under `paths` (Epic #730 Story 7) and
 * are filled in by {@link resolvePaths} via the post-load mutation. The
 * three required ones come from the operator's config; `auditOutputDir`
 * defaults to `'temp'` inside `resolvePaths`.
 */
const LOADED_CONFIG_DEFAULTS = Object.freeze({
  scriptsRoot: '.agents/scripts',
  workflowsRoot: '.agents/workflows',
  personasRoot: '.agents/personas',
  schemasRoot: '.agents/schemas',
  skillsRoot: '.agents/skills',
  templatesRoot: '.agents/templates',
  rulesRoot: '.agents/rules',
  docsContextFiles: [
    'architecture.md',
    'data-dictionary.md',
    'decisions.md',
    'patterns.md',
  ],
  // The legacy `maintainability` flat default was removed in Epic #730 Story 6
  // — the same content now lives under `quality.maintainability` and is filled
  // in by {@link resolveQuality}. The runtime ceiling defaults
  // (maxTickets / maxTokenBudget / executionTimeoutMs / executionMaxBuffer)
  // moved under `limits` in Story 8 and are filled in by {@link resolveLimits}.
});

/** Defaults for the zero-config (no .agentrc.json present) path.
 *
 * Same omission rule as {@link LOADED_CONFIG_DEFAULTS}: the path roots live
 * under `paths` (Story 7), and the three required ones cannot be silently
 * filled in. Zero-config callers that need them must declare a `.agentrc.json`. */
const ZERO_CONFIG_DEFAULTS = Object.freeze({
  scriptsRoot: '.agents/scripts',
  workflowsRoot: '.agents/workflows',
  personasRoot: '.agents/personas',
  schemasRoot: '.agents/schemas',
  skillsRoot: '.agents/skills',
  templatesRoot: '.agents/templates',
  rulesRoot: '.agents/rules',
  docsContextFiles: [
    'architecture.md',
    'data-dictionary.md',
    'decisions.md',
    'patterns.md',
  ],
  // Same Story-6 flattening as LOADED_CONFIG_DEFAULTS — `maintainability` no
  // longer lives at the top level. Zero-config callers get the merged shape
  // via the post-load `resolveQuality(settings.quality)` mutation below. The
  // runtime ceilings moved under `limits` in Story 8; resolveLimits fills
  // them in via the same post-load mutation pattern.
  baseBranch: 'main',
});

/** Framework defaults for `agentSettings.quality.crap` (lifted out of the
 * legacy `agentSettings.maintainability.crap` nest in Epic #730 Story 6).
 * Applied via {@link resolveQuality} so a consumer repo that omits the block
 * (or any key within it) still gets sane defaults. Exported for tests and
 * for consumers that want to introspect the canonical shape. */
export const MAINTAINABILITY_CRAP_DEFAULTS = Object.freeze({
  enabled: true,
  targetDirs: Object.freeze(['src']),
  newMethodCeiling: 30,
  coveragePath: 'coverage/coverage-final.json',
  tolerance: 0.001,
  requireCoverage: true,
  friction: Object.freeze({ markerKey: 'crap-baseline-regression' }),
  refreshTag: 'baseline-refresh:',
});

/** Recognized keys for `quality.crap` (post-Story-6). Used by the resolver
 * to warn (not fail) on unknown keys per AC19. */
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
 * Merge a user-supplied `quality.crap` block with framework defaults.
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
      console.warn(`[config] Unknown key 'quality.crap.${key}' — ignoring.`);
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
 * Framework defaults for `agentSettings.quality.maintainability` — the per-file
 * MI targeting block. Empty `targetDirs` means "no MI scan unless the operator
 * declares targets". Lifted out of the old flat-key default in Story 6.
 */
export const MAINTAINABILITY_QUALITY_DEFAULTS = Object.freeze({
  targetDirs: Object.freeze([]),
});

/**
 * Merge a user-supplied `quality.maintainability` block with framework
 * defaults. The grouped block now carries only `targetDirs`; the legacy
 * nested `crap` was lifted to `quality.crap` and is resolved separately by
 * {@link resolveMaintainabilityCrap} via {@link resolveQuality}.
 *
 * @param {object|undefined} userBlock
 * @returns {{ targetDirs: string[] }}
 */
export function resolveMaintainabilityQuality(userBlock) {
  const defaultTargetDirs = MAINTAINABILITY_QUALITY_DEFAULTS.targetDirs;
  if (userBlock == null || typeof userBlock !== 'object') {
    return { targetDirs: [...defaultTargetDirs] };
  }
  return {
    targetDirs: resolveListValue(defaultTargetDirs, userBlock.targetDirs),
  };
}

/** Keys to apply on top of a loaded config when the operator omitted them.
 * `quality`, `paths`, and `limits` are intentionally absent — they are
 * filled by `resolveQuality` / `resolvePaths` / `resolveLimits` below
 * (deep-merge, not top-level fill) right after this loop runs.
 * `auditOutputDir` lives under `paths` (Story 7); the runtime ceilings
 * (maxTickets / maxTokenBudget / executionTimeoutMs / executionMaxBuffer)
 * live under `limits` (Story 8). */
const LOADED_CONFIG_APPLY_KEYS = [
  'scriptsRoot',
  'workflowsRoot',
  'personasRoot',
  'schemasRoot',
  'skillsRoot',
  'templatesRoot',
  'rulesRoot',
  'docsContextFiles',
  'baseBranch',
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
        .map((e) => {
          // For required-property failures, AJV reports the parent path; the
          // human-readable message already names the missing key. Prefix the
          // path so multiple errors are still distinguishable.
          const where = e.instancePath || '(agentSettings)';
          return `${where} ${e.message}`;
        })
        .join(', ');
      throw new Error(
        `[config] Invalid agentSettings in .agentrc.json: ${details}`,
      );
    }

    const orchestration = raw.orchestration ?? null;
    const audits = raw.audits ?? null;

    // Apply defaults to the loaded config. Missing keys that are also absent
    // from LOADED_CONFIG_DEFAULTS (e.g. docsRoot, tempRoot, baseBranch)
    // resolve to `undefined`, preserving the long-standing zero-config/
    // loaded-config asymmetry rather than silently promoting the richer
    // zero-config set.
    for (const key of LOADED_CONFIG_APPLY_KEYS) {
      settings[key] = settings[key] ?? LOADED_CONFIG_DEFAULTS[key];
    }

    // Deep-merge the grouped quality block (Story 6 unification): targetDirs
    // list-extender, CRAP defaults, prGate checks, and baselines paths are all
    // filled in here so consumers can read `settings.quality.<sub>.<key>`
    // without re-running merge logic at every call site.
    settings.quality = resolveQuality(settings.quality);
    // Story 7 — fill in `paths.auditOutputDir` default in place. The three
    // required path roots are schema-enforced; the operator's values flow
    // through unchanged.
    settings.paths = resolvePaths(settings.paths);
    // Story 8 — fill in `limits` defaults (counts, budgets, timeouts, friction
    // thresholds) so direct readers see merged values without re-applying
    // fallbacks at every call site.
    settings.limits = resolveLimits(settings.limits);

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
  zeroSettings.quality = resolveQuality(zeroSettings.quality);
  zeroSettings.paths = resolvePaths(zeroSettings.paths);
  zeroSettings.limits = resolveLimits(zeroSettings.limits);
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
 * Resolve whether worktree isolation is enabled for this process, with strict
 * environment-variable precedence that outranks the committed config value.
 *
 * Precedence:
 *   1. `env.AP_WORKTREE_ENABLED === 'true'`  → true   (explicit operator override)
 *   2. `env.AP_WORKTREE_ENABLED === 'false'` → false  (explicit operator override)
 *   3. `env.CLAUDE_CODE_REMOTE === 'true'`   → false  (web session auto-detect)
 *   4. else                                  → Boolean(config.orchestration.worktreeIsolation.enabled)
 *
 * String matching on `AP_WORKTREE_ENABLED` is deliberate: `""`, `"0"`, or any
 * other truthy-ish shell expansion must not flip the flag.
 *
 * @param {{ config?: { orchestration?: { worktreeIsolation?: { enabled?: boolean } } | null } }} [opts]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function resolveWorktreeEnabled(opts = {}, env = process.env) {
  if (env.AP_WORKTREE_ENABLED === 'true') return true;
  if (env.AP_WORKTREE_ENABLED === 'false') return false;
  if (env.CLAUDE_CODE_REMOTE === 'true') return false;
  return Boolean(opts.config?.orchestration?.worktreeIsolation?.enabled);
}

/**
 * Resolve the absolute working path the agent should `cd` into for a given
 * Story. When worktree isolation is on, returns the per-story worktree path
 * (`<repoRoot>/<wtRoot>/story-<id>`). When off, returns the repo root so
 * init, close, and recovery converge on a single canonical path with no
 * undefined-path access on the off-branch.
 *
 * Pure helper — no fs / git side effects. Path-traversal containment for
 * `worktreeRoot` is enforced earlier by `validateOrchestrationConfig`.
 *
 * @param {object} opts
 * @param {boolean} opts.worktreeEnabled
 * @param {string} opts.repoRoot          Absolute path to the main checkout.
 * @param {number|string} [opts.storyId]  Required when `worktreeEnabled` is true.
 * @param {string} [opts.worktreeRoot]    Worktree root relative to repoRoot. Defaults to `.worktrees`.
 * @returns {string} Absolute path the agent should work from.
 */
export function resolveWorkingPath({
  worktreeEnabled,
  repoRoot,
  storyId,
  worktreeRoot = '.worktrees',
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new Error('resolveWorkingPath: repoRoot is required');
  }
  // Caller is responsible for passing an already-absolute repoRoot (every
  // production caller threads `path.resolve(...)` upstream). We do not
  // re-resolve here so unit-test fixtures that pass sentinel paths like
  // `/repo` keep their semantics on Windows.
  if (!worktreeEnabled) return repoRoot;
  if (storyId == null) {
    throw new Error(
      'resolveWorkingPath: storyId is required when worktreeEnabled is true',
    );
  }
  return path.join(repoRoot, worktreeRoot, `story-${storyId}`);
}

/**
 * One-shot environment-aware runtime resolution. Returns the trio of runtime
 * signals consumed across `/sprint-execute`: whether worktree isolation is on
 * for this process, the session id for claim labels, and whether we're in a
 * Claude Code web session. Each signal also records its **source** so the
 * `sprint-story-init` startup log can name why the value is what it is.
 *
 * @param {{ config?: object }} [opts]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   worktreeEnabled: boolean,
 *   worktreeEnabledSource: 'env-override' | 'remote-auto' | 'config',
 *   sessionId: string,
 *   sessionIdSource: 'remote' | 'local',
 *   isRemote: boolean,
 * }}
 */
export function resolveRuntime(opts = {}, env = process.env) {
  const worktreeEnabled = resolveWorktreeEnabled(opts, env);
  const worktreeEnabledSource =
    env.AP_WORKTREE_ENABLED === 'true' || env.AP_WORKTREE_ENABLED === 'false'
      ? 'env-override'
      : env.CLAUDE_CODE_REMOTE === 'true'
        ? 'remote-auto'
        : 'config';

  const remoteId = env.CLAUDE_CODE_REMOTE_SESSION_ID;
  const remoteUsable =
    typeof remoteId === 'string' &&
    remoteId.toLowerCase().replace(SESSION_ID_ALLOWED_CHAR_RE, '').length > 0;
  const sessionId = resolveSessionId(env);
  const sessionIdSource = remoteUsable ? 'remote' : 'local';

  return {
    worktreeEnabled,
    worktreeEnabledSource,
    sessionId,
    sessionIdSource,
    isRemote: env.CLAUDE_CODE_REMOTE === 'true',
  };
}

const SESSION_ID_LENGTH = 12;
const SESSION_ID_ALLOWED_CHAR_RE = /[^a-z0-9]/g;

/**
 * Resolve the per-process session-id used for claim labels and structured
 * comments. Prefers the Anthropic-provided `CLAUDE_CODE_REMOTE_SESSION_ID`
 * (sanitised and truncated) and falls back to a locally-generated short id
 * derived from hostname + pid + random entropy.
 *
 * Sanitisation for the remote id:
 *   1. Lower-case.
 *   2. Strip every character outside `[a-z0-9]`.
 *   3. Truncate to {@link SESSION_ID_LENGTH} (12) chars.
 *   4. If the sanitised result is empty, fall back to the locally-generated id
 *      — an all-symbol remote id is not a usable label suffix.
 *
 * The return value is always a string of 1..12 chars matching `[a-z0-9]+`, so
 * callers can inline it into `in-progress-by:<id>` labels without further
 * escaping. See tech spec #670 § Security — Env-var injection.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveSessionId(env = process.env) {
  const remote = env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (typeof remote === 'string' && remote.length > 0) {
    const sanitised = remote
      .toLowerCase()
      .replace(SESSION_ID_ALLOWED_CHAR_RE, '')
      .slice(0, SESSION_ID_LENGTH);
    if (sanitised.length > 0) return sanitised;
  }
  return generateLocalSessionId();
}

function generateLocalSessionId() {
  // Layout: 2 host chars + 2 pid chars + 8 random hex chars = 12 chars. The
  // random suffix is load-bearing for uniqueness; host/pid hints are
  // operator-friendly context, not identifiers.
  const host = (os.hostname() || 'h')
    .toLowerCase()
    .replace(SESSION_ID_ALLOWED_CHAR_RE, '')
    .slice(0, 2)
    .padEnd(2, '0');
  const pid = String(process.pid)
    .replace(SESSION_ID_ALLOWED_CHAR_RE, '')
    .slice(-2)
    .padStart(2, '0');
  const rand = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  return `${host}${pid}${rand}`.slice(0, SESSION_ID_LENGTH);
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

/**
 * Defaults applied when a setting omits `agentSettings.commands` or any field
 * within it. Mirrors the long-standing built-in fallbacks the framework used
 * before Epic #730 Story 5 grouped these keys; consumers that previously read
 * `settings.<flatCommand> ?? '<default>'` now go through {@link getCommands}.
 *
 * `typecheck` and `build` default to `null` (Story 3 disabled-means-null
 * convention) — consumers short-circuit on falsy values.
 */
export const COMMANDS_DEFAULTS = Object.freeze({
  validate: 'npm run lint',
  lintBaseline: 'npx eslint . --format json',
  test: 'npm test',
  exploratoryTest: 'npm test',
  typecheck: null,
  build: null,
});

/**
 * Read the grouped `agentSettings.commands` block, applying framework defaults
 * for any field the operator omitted.
 *
 * @param {{ agentSettings?: { commands?: object } } | object | null | undefined} config
 *   Either the full resolved config (`{ agentSettings, orchestration, ... }`)
 *   or the bare `agentSettings` bag — both shapes are accepted so call sites
 *   can pass whichever they already have in scope.
 * @returns {{ validate: string, lintBaseline: string, test: string, exploratoryTest: string, typecheck: string|null, build: string|null }}
 */
export function getCommands(config) {
  const commands = config?.agentSettings?.commands || config?.commands || {};
  return {
    validate: commands.validate ?? COMMANDS_DEFAULTS.validate,
    lintBaseline: commands.lintBaseline ?? COMMANDS_DEFAULTS.lintBaseline,
    test: commands.test ?? COMMANDS_DEFAULTS.test,
    exploratoryTest:
      commands.exploratoryTest ?? COMMANDS_DEFAULTS.exploratoryTest,
    typecheck:
      commands.typecheck === undefined
        ? COMMANDS_DEFAULTS.typecheck
        : commands.typecheck,
    build:
      commands.build === undefined ? COMMANDS_DEFAULTS.build : commands.build,
  };
}

/**
 * Canonical on-disk locations for every ratchet baseline (Epic #730 Story 5.5).
 * The framework treats `<repoRoot>/baselines/` as the single tracked directory
 * for `lint.json` / `crap.json` / `maintainability.json`; operators may
 * override per-baseline `path` in `agentSettings.quality.baselines.*` but the
 * defaults are designed so a fresh clone has working ratchets immediately.
 */
export const BASELINES_DEFAULTS = Object.freeze({
  lint: Object.freeze({ path: 'baselines/lint.json', refreshCommand: null }),
  crap: Object.freeze({ path: 'baselines/crap.json', refreshCommand: null }),
  maintainability: Object.freeze({
    path: 'baselines/maintainability.json',
    refreshCommand: null,
  }),
});

/**
 * Read the grouped `agentSettings.quality.baselines` block, applying framework
 * defaults for any baseline (or any field within a baseline) the operator
 * omitted. Returns a `{ lint, crap, maintainability }` trio whose entries are
 * each `{ path, refreshCommand }` — never `undefined`.
 *
 * @param {{ agentSettings?: { quality?: { baselines?: object } } } | object | null | undefined} config
 * @returns {{ lint: { path: string, refreshCommand: string|null }, crap: { path: string, refreshCommand: string|null }, maintainability: { path: string, refreshCommand: string|null } }}
 */
export function getBaselines(config) {
  const baselines =
    config?.agentSettings?.quality?.baselines ||
    config?.quality?.baselines ||
    {};
  const merge = (key) => {
    const fallback = BASELINES_DEFAULTS[key];
    const user = baselines[key] ?? {};
    return {
      path: user.path ?? fallback.path,
      refreshCommand:
        user.refreshCommand === undefined
          ? fallback.refreshCommand
          : user.refreshCommand,
    };
  };
  return {
    lint: merge('lint'),
    crap: merge('crap'),
    maintainability: merge('maintainability'),
  };
}

/**
 * Framework defaults for `agentSettings.quality.prGate`. `checks` defaults to
 * an empty array so `git-pr-quality-gate.js` falls back to its hardcoded
 * DEFAULT_CHECKS trio (lint / format:check / test) when the operator hasn't
 * customised the suite.
 */
export const PR_GATE_DEFAULTS = Object.freeze({
  checks: Object.freeze([]),
});

/**
 * Merge the user-supplied `quality.prGate` block with framework defaults.
 *
 * @param {object|undefined} userBlock
 * @returns {{ checks: string[] }}
 */
export function resolvePrGate(userBlock) {
  if (userBlock == null || typeof userBlock !== 'object') {
    return { checks: [...PR_GATE_DEFAULTS.checks] };
  }
  return {
    checks: Array.isArray(userBlock.checks)
      ? [...userBlock.checks]
      : [...PR_GATE_DEFAULTS.checks],
  };
}

/**
 * Merge the user-supplied `quality.baselines` block with framework defaults.
 * Mirrors {@link getBaselines} but returns the same `{ lint, crap,
 * maintainability }` trio shape — used during the in-place defaults pass so
 * `settings.quality.baselines` is fully populated for any direct reader.
 *
 * @param {object|undefined} userBlock
 */
export function resolveBaselines(userBlock) {
  return getBaselines({ quality: { baselines: userBlock ?? {} } });
}

/**
 * Merge the entire `agentSettings.quality` block with framework defaults
 * (Epic #730 Story 6). Composes the per-sub-block resolvers so consumers can
 * read every grouped field — `targetDirs`, `crap.*`, `prGate.checks`,
 * `baselines.<kind>.path` — without re-running merge logic at the call site.
 *
 * @param {object|undefined} userQuality
 * @returns {{
 *   maintainability: { targetDirs: string[] },
 *   crap: object,
 *   prGate: { checks: string[] },
 *   baselines: { lint: object, crap: object, maintainability: object }
 * }}
 */
export function resolveQuality(userQuality) {
  const block =
    userQuality && typeof userQuality === 'object' ? userQuality : {};
  return {
    maintainability: resolveMaintainabilityQuality(block.maintainability),
    crap: resolveMaintainabilityCrap(block.crap),
    prGate: resolvePrGate(block.prGate),
    baselines: resolveBaselines(block.baselines),
  };
}

/**
 * Read the merged `agentSettings.quality` block. Accepts either the full
 * resolved config (`{ agentSettings, ... }`) or the bare `agentSettings` bag.
 *
 * @param {{ agentSettings?: { quality?: object } } | object | null | undefined} config
 * @returns {ReturnType<typeof resolveQuality>}
 */
export function getQuality(config) {
  const userQuality =
    config?.agentSettings?.quality ?? config?.quality ?? undefined;
  return resolveQuality(userQuality);
}

/**
 * Framework defaults for `agentSettings.paths` (Epic #730 Story 7).
 * Only the optional `auditOutputDir` has a default — the three required
 * roots are schema-enforced and the resolver never silently fills them in.
 */
export const PATHS_DEFAULTS = Object.freeze({
  auditOutputDir: 'temp',
});

/**
 * Merge a user-supplied `paths` block with framework defaults. Required
 * roots (`agentRoot` / `docsRoot` / `tempRoot`) flow through verbatim —
 * the schema rejects a config that omits them. `auditOutputDir` falls back
 * to {@link PATHS_DEFAULTS}.
 *
 * @param {object|undefined} userPaths
 * @returns {{ agentRoot?: string, docsRoot?: string, tempRoot?: string, auditOutputDir: string }}
 */
export function resolvePaths(userPaths) {
  const paths = userPaths && typeof userPaths === 'object' ? userPaths : {};
  return {
    agentRoot: paths.agentRoot,
    docsRoot: paths.docsRoot,
    tempRoot: paths.tempRoot,
    auditOutputDir: paths.auditOutputDir ?? PATHS_DEFAULTS.auditOutputDir,
  };
}

/**
 * Read the merged `agentSettings.paths` block. Accepts either the full
 * resolved config or the bare `agentSettings` bag.
 *
 * @param {{ agentSettings?: { paths?: object } } | object | null | undefined} config
 * @returns {ReturnType<typeof resolvePaths>}
 */
export function getPaths(config) {
  const userPaths =
    config?.agentSettings?.paths ?? config?.paths ?? undefined;
  return resolvePaths(userPaths);
}

/**
 * Framework defaults for `agentSettings.limits` (Epic #730 Story 8). Mirrors
 * the long-standing flat-key fallbacks the framework used before grouping —
 * `maxTickets: 40`, 5-minute exec timeout, 10MB exec buffer, 200k token
 * budget. `friction` defaults match the prior `frictionThresholds` block.
 */
export const LIMITS_DEFAULTS = Object.freeze({
  maxInstructionSteps: 5,
  maxTickets: 40,
  maxTokenBudget: 200000,
  executionTimeoutMs: 300000,
  executionMaxBuffer: 10485760,
  friction: Object.freeze({
    repetitiveCommandCount: 3,
    consecutiveErrorCount: 3,
    stagnationStepCount: 5,
    maxIntegrationRetries: 2,
  }),
});

/**
 * Merge a user-supplied `agentSettings.limits` block with framework defaults.
 * Scalar keys replace; the nested `friction` block is merged shallowly so an
 * operator can override a single threshold without re-listing the others.
 *
 * @param {object|undefined} userLimits
 * @returns {{
 *   maxInstructionSteps: number,
 *   maxTickets: number,
 *   maxTokenBudget: number,
 *   executionTimeoutMs: number,
 *   executionMaxBuffer: number,
 *   friction: {
 *     repetitiveCommandCount: number,
 *     consecutiveErrorCount: number,
 *     stagnationStepCount: number,
 *     maxIntegrationRetries: number,
 *   },
 * }}
 */
export function resolveLimits(userLimits) {
  const block =
    userLimits && typeof userLimits === 'object' ? userLimits : {};
  const userFriction =
    block.friction && typeof block.friction === 'object' ? block.friction : {};
  return {
    maxInstructionSteps:
      block.maxInstructionSteps ?? LIMITS_DEFAULTS.maxInstructionSteps,
    maxTickets: block.maxTickets ?? LIMITS_DEFAULTS.maxTickets,
    maxTokenBudget: block.maxTokenBudget ?? LIMITS_DEFAULTS.maxTokenBudget,
    executionTimeoutMs:
      block.executionTimeoutMs ?? LIMITS_DEFAULTS.executionTimeoutMs,
    executionMaxBuffer:
      block.executionMaxBuffer ?? LIMITS_DEFAULTS.executionMaxBuffer,
    friction: { ...LIMITS_DEFAULTS.friction, ...userFriction },
  };
}

/**
 * Read the merged `agentSettings.limits` block. Accepts either the full
 * resolved config or the bare `agentSettings` bag.
 *
 * @param {{ agentSettings?: { limits?: object } } | object | null | undefined} config
 * @returns {ReturnType<typeof resolveLimits>}
 */
export function getLimits(config) {
  const userLimits =
    config?.agentSettings?.limits ?? config?.limits ?? undefined;
  return resolveLimits(userLimits);
}
