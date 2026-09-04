/**
 * lib/audit-suite/selector.js — `selectAudits` rule-matching core.
 *
 * Extracted from `.agents/scripts/select-audits.js` (Story #1083, Epic
 * #1072) so the audit-suite SDK barrel at `./index.js` can re-export it
 * without importing upward from a top-level CLI file.
 *
 * Pure (modulo `gitSpawn`) — exposed helpers are:
 *   - matchesFilePattern         — single file × single glob (picomatch, `dot`)
 *   - matchesAnyFilePattern      — file list × pattern list, short-circuiting
 *   - selectSensitivePathClasses — change set × the manifest's `sensitivePaths`
 *                                  block; the review-depth derivation's matcher
 *   - selectAudits               — main entry; reads audit-rules.json, runs `git
 *                                  diff --name-only`, applies keyword + glob
 *                                  rules.
 *
 * All rule-matching lives here; the former `select-audits.js` CLI wrapper
 * was retired in #4482 (consumers call `selectAudits` via the barrel).
 */

import { readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { getPaths, PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { softFailOrThrow } from '../degraded-mode.js';
import { gitSpawn } from '../git-utils.js';
import { withTimeout } from '../util/with-timeout.js';
import { readAuditRulesSync } from './audit-rules-reader.js';

const DEFAULT_GIT_TIMEOUT_MS = 30000;

/**
 * The canonical concern-ownership tiers a lens can declare via its
 * `scope` field in [`audit-rules.json`](../../../schemas/audit-rules.json).
 * This frozen tuple is the single source of truth for the tier vocabulary the
 * schema's `scope` enum enforces and {@link resolveLensTier} returns:
 *
 *   - `local`      — decidable from a single Story's diff; verified at
 *                    write-time and Story-scope review, not re-run at Epic close.
 *   - `cumulative` — only decidable across the Epic's combined diff; verified
 *                    at Epic close.
 *   - `global`     — evaluates a whole-product property regardless of the diff;
 *                    verified at Epic close, exempt from change-set narrowing.
 *
 * @type {readonly ['local', 'cumulative', 'global']}
 */
export const LENS_TIERS = Object.freeze(['local', 'cumulative', 'global']);

/**
 * Resolve the concern-ownership tier a lens declares in `audit-rules.json`.
 * This is the pure read-side of the `scope` field (Epic #4405, Story #4407)
 * that replaced the former `alwaysRun` special case: every downstream tier —
 * write-time checklist threading, Story-scope review, the Epic-close roster
 * split — routes off this one field instead of a maintained prose constraint.
 *
 * Deterministic given the on-disk manifest: it reads the same
 * `audit-rules.json` that {@link selectAudits} consumes (resolved through the
 * project's configured `schemasRoot`), looks up the lens, and returns its
 * `scope`. It takes no ticket, runs no git, and has no side effects.
 *
 * @param {string} lens Lens key registered in `audit-rules.json`
 *   (e.g. `audit-clean-code`).
 * @returns {'local' | 'cumulative' | 'global'} The lens's declared tier.
 * @throws {Error} When `lens` is not registered in the manifest, or the
 *   manifest cannot be read, or the registered entry carries a scope outside
 *   {@link LENS_TIERS}.
 */
export function resolveLensTier(lens) {
  const rulesData = readAuditRulesSync();

  const entry = rulesData.audits?.[lens];
  if (!entry) {
    throw new Error(
      `resolveLensTier: unknown lens '${lens}' — not registered in audit-rules.json`,
    );
  }

  const { scope } = entry;
  if (!LENS_TIERS.includes(scope)) {
    throw new Error(
      `resolveLensTier: lens '${lens}' declares invalid scope '${scope}'; expected one of ${LENS_TIERS.join(', ')}`,
    );
  }

  return scope;
}

/**
 * Select the LOCAL-tier lenses whose `filePatterns` triggers match a change
 * set. This is the Story-scope roster used by the maker-blind story-close
 * review (Epic #4405, Story #4409): a lens is selected iff
 * `resolveLensTier(lens) === 'local'` **and** the pure
 * {@link matchesAnyFilePattern} matcher hits at least one of `changedFiles`
 * against the lens's registered `triggers.filePatterns`.
 *
 * This deliberately does **not** call {@link selectAudits}: `selectAudits`
 * unions in keyword-matched and gate-scoped lenses and has no per-tier gate,
 * so it would widen the roster beyond the local, footprint-matched set the
 * shift-left Story-scope tier owns. A local lens with a universal
 * `filePatterns` glob (e.g. `audit-clean-code`, whose sole pattern matches
 * every path) matches every change set here, so its concern is verified at
 * BOTH innermost tiers — the
 * write-time checklist threading and this Story-scope lens pass — and excluded
 * from the retired Epic-close roster (local lenses stay Story-scope only).
 * A local lens with an empty `filePatterns` list matches nothing here, so a
 * diff matching no local lens's patterns yields an empty roster and adds no
 * lens work.
 *
 * Pure over its injected seams: `injectedRules` skips the disk read of the
 * manifest and `resolveLensTierFn` overrides the tier resolver, so callers can
 * exercise the selection without touching the filesystem. Selection order
 * follows the manifest's declaration order, which is deterministic.
 *
 * @param {{
 *   changedFiles?: string[],
 *   injectedRules?: { audits?: Record<string, object> },
 *   resolveLensTierFn?: typeof resolveLensTier,
 * }} [params]
 * @returns {string[]} The matched local-lens identifiers, in manifest order.
 */
export function selectLocalLenses({
  changedFiles,
  injectedRules,
  resolveLensTierFn = resolveLensTier,
} = {}) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  if (files.length === 0) return [];

  const rules = injectedRules ?? readAuditRulesSync();
  const selected = [];
  for (const [lens, entry] of Object.entries(rules.audits ?? {})) {
    if (resolveLensTierFn(lens) !== 'local') continue;
    const patterns = entry?.triggers?.filePatterns ?? [];
    if (matchesAnyFilePattern(patterns, files)) {
      selected.push(lens);
    }
  }
  return selected;
}

/**
 * Select the sensitive-path classes a change set touches, from the
 * `sensitivePaths` block of [`audit-rules.json`](../../../schemas/audit-rules.json).
 *
 * This is the matcher behind the close-time review-depth derivation
 * (`review-depth.js#deriveChangeLevel`, Story #4542): a change set intersecting
 * any registered class's globs is *observably* sensitive — auth, a migration, a
 * billing path — and earns a deep pass however narrow the diff is. The classes
 * and their globs live in the manifest next to the lens `triggers.filePatterns`
 * precisely so an operator can extend them without a code change, and matching
 * runs through the same {@link matchesAnyFilePattern} picomatch machinery rather
 * than a second matcher with its own glob semantics.
 *
 * An empty change set, an absent `sensitivePaths` block, or a class whose globs
 * match nothing all contribute no class — the caller then resolves depth from
 * diff width alone.
 *
 * Pure over its injected seam: `injectedRules` skips the manifest disk read.
 * Selection order follows the manifest's declaration order, which is
 * deterministic.
 *
 * @param {{
 *   changedFiles?: string[],
 *   injectedRules?: { sensitivePaths?: Record<string, { filePatterns?: string[] }> },
 * }} [params]
 * @returns {string[]} The matched class names, in manifest order.
 */
export function selectSensitivePathClasses({
  changedFiles,
  injectedRules,
} = {}) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  if (files.length === 0) return [];

  const rules = injectedRules ?? readAuditRulesSync();
  const matched = [];
  for (const [name, entry] of Object.entries(rules.sensitivePaths ?? {})) {
    if (matchesAnyFilePattern(entry?.filePatterns ?? [], files)) {
      matched.push(name);
    }
  }
  return matched;
}

/**
 * Resolve the consumer's navigability route globs from the resolved config.
 * Reads `delivery.quality.navigability.routeGlobs` — the route-tree SSOT the
 * navigability lens enumerates. Returns an empty array when the block (or any
 * ancestor) is absent, so an unconfigured consumer contributes no web-surface
 * evidence (Epic #4131 — "no-op when unconfigured").
 *
 * Module-local: the sole reader is {@link hasWebSurface}. It was previously
 * exported alongside a route-added routing seam that Story #4926 removed —
 * lens routing is decided by the `scope` field in `audit-rules.json`, never by
 * a second predicate here.
 *
 * @param {object|null|undefined} config Resolved `.agentrc.json` wrapper.
 * @returns {string[]} Route globs, or `[]` when unconfigured.
 */
function resolveNavigabilityRouteGlobs(config) {
  const globs = config?.delivery?.quality?.navigability?.routeGlobs;
  return Array.isArray(globs) ? globs.filter((g) => typeof g === 'string') : [];
}

/**
 * Package names (or scope/name segments of them) that declare a **web
 * rendering surface**. Matched against the consumer's root `package.json`
 * `dependencies` + `devDependencies` keys, segment-wise, so `@angular/core`
 * matches via `angular` and `@remix-run/react` via `react`.
 */
const WEB_FRAMEWORK_PACKAGES = Object.freeze([
  'react',
  'next',
  'vue',
  'svelte',
  'sveltekit',
  'astro',
  'nuxt',
  'remix',
  'remix-run',
  'gatsby',
  'angular',
]);

/** File extensions whose presence in the source tree implies a web surface. */
const WEB_ASSET_EXTENSIONS = Object.freeze(['.html', '.css', '.jsx', '.tsx']);

/**
 * Directories the web-surface file scan never descends into. `node_modules` is
 * the load-bearing one (a dependency's bundled `.css` says nothing about the
 * consumer's own surface); the test directories are excluded because a fixture
 * `.html` is a test artifact, not a shipped page.
 */
const WEB_SCAN_SKIP_DIRS = Object.freeze([
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'build',
  'out',
  'coverage',
  'temp',
  'tmp',
  'tests',
  'test',
  '__tests__',
  '__mocks__',
  'spec',
  'e2e',
  'fixtures',
]);

/** Scan bounds — the probe is a cheap heuristic, not an exhaustive crawl. */
const WEB_SCAN_MAX_DEPTH = 6;
const WEB_SCAN_MAX_ENTRIES = 4000;

/**
 * Process-lifetime memo for the filesystem half of the web-surface probe,
 * keyed by project root. The config half ({@link resolveNavigabilityRouteGlobs})
 * is a free object read and is deliberately NOT memoized, so a caller passing a
 * different config never reads a stale answer.
 *
 * @type {Map<string, boolean>}
 */
const _webSurfaceFsCache = new Map();

/** Test-only: drop the memo so a fixture root can be re-probed after edits. */
export function _resetWebSurfaceCache() {
  _webSurfaceFsCache.clear();
}

/**
 * True when the root `package.json` declares a dependency whose name (or a
 * scope/name segment of it) appears in `packageList`. The shared probe behind
 * {@link declaresWebFramework} and {@link declaresOrmDependency}.
 *
 * Returns `null` — *indeterminate* — when the manifest exists but cannot be
 * read or parsed; callers fail open on that. A genuinely absent manifest
 * (`ENOENT`) is determinate: there is no declaration, so there is no signal,
 * and the file scan gets its turn.
 *
 * @param {string} root
 * @param {readonly string[]} packageList
 * @returns {boolean|null}
 */
function declaresDependencyIn(root, packageList) {
  let raw;
  try {
    raw = readFileSync(path.join(root, 'package.json'), 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    return null;
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }
  const names = [
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ];
  return names.some((name) =>
    name
      .replace(/^@/, '')
      .split('/')
      .some((segment) => packageList.includes(segment)),
  );
}

/**
 * True when the root `package.json` declares a web-framework dependency.
 * Tri-state contract per {@link declaresDependencyIn}; the fail-open caller
 * is {@link hasWebSurface}.
 *
 * @param {string} root
 * @returns {boolean|null}
 */
function declaresWebFramework(root) {
  return declaresDependencyIn(root, WEB_FRAMEWORK_PACKAGES);
}

/**
 * True when a bounded scan of the source tree finds a web asset file
 * (`.html` / `.css` / `.jsx` / `.tsx`) outside the skipped directories.
 * Returns `null` — *indeterminate* — when the root itself is unreadable, or
 * when the scan exhausted its entry budget without finding one: a truncated
 * scan genuinely did not finish looking, and reporting "no web surface" from
 * a half-walked tree would silently drop lens coverage.
 *
 * Uses `readdirSync(withFileTypes)` rather than `git ls-files` — a filesystem
 * check suffices, and shelling out to git would make the probe cost a process
 * spawn on every selection.
 *
 * @param {string} root
 * @returns {boolean|null}
 */
function scanForWebAssets(root) {
  let budget = WEB_SCAN_MAX_ENTRIES;
  const queue = [{ dir: root, depth: 0 }];
  let rootRead = false;

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A single unreadable subdirectory is skipped: a permissions oddity is
      // far likelier than an entire web surface hiding behind it. An
      // unreadable ROOT is a different story — see below.
      if (dir === root) return null;
      continue;
    }
    if (dir === root) rootRead = true;

    for (const entry of entries) {
      if (budget-- <= 0) return null; // truncated ⇒ indeterminate
      if (entry.isDirectory()) {
        if (WEB_SCAN_SKIP_DIRS.includes(entry.name)) continue;
        if (depth + 1 <= WEB_SCAN_MAX_DEPTH) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (WEB_ASSET_EXTENSIONS.includes(path.extname(entry.name))) return true;
    }
  }
  return rootRead ? false : null;
}

/**
 * Decide whether the project has a **web surface** — the applicability
 * predicate behind the `target: "web"` gate in `audit-rules.json` (#4579).
 *
 * Mandrel is materialized into other projects, so this cannot be a property of
 * *this* repository: a consumer with a real web surface MUST still get the web
 * lenses. It is therefore derived from observables in the consumer's own
 * checkout, and deliberately NOT from a new `.agentrc` key — a new key would
 * have to be threaded through the runtime AJV (`lib/config-settings-schema*.js`)
 * *and* the published mirror, and would make consumers hand-configure something
 * already derivable.
 *
 * A project is web-capable when ANY of these hold:
 *   1. `delivery.quality.navigability.routeGlobs` is configured — the existing
 *      web signal the navigability lens already routes off.
 *   2. The root `package.json` declares a web framework (react / next / vue /
 *      svelte / astro / nuxt / remix / gatsby / angular).
 *   3. A bounded source scan finds a `.html` / `.css` / `.jsx` / `.tsx` file
 *      outside test directories.
 *
 * **Fail direction: OPEN.** When a signal is indeterminate — an unparseable
 * `package.json`, an unreadable root, a scan that hit its entry budget — the
 * project is treated as web-capable. A false positive costs one wasted lens
 * run; a false negative silently drops audit coverage on a project that has a
 * real web surface, and nothing downstream would ever report the omission.
 * Wasted spend is recoverable; dropped coverage is not.
 *
 * @param {{ config?: object|null, projectRoot?: string }} [params]
 * @returns {boolean}
 */
export function hasWebSurface({ config, projectRoot = PROJECT_ROOT } = {}) {
  if (resolveNavigabilityRouteGlobs(config).length > 0) return true;

  if (_webSurfaceFsCache.has(projectRoot)) {
    return _webSurfaceFsCache.get(projectRoot);
  }

  const declared = declaresWebFramework(projectRoot);
  // `null` is indeterminate, not false — fail open.
  const result =
    declared === null || declared === true
      ? true
      : scanForWebAssets(projectRoot) !== false;

  _webSurfaceFsCache.set(projectRoot, result);
  return result;
}

/**
 * Package names (or scope/name segments of them) that declare a **persistence
 * layer** — ORMs and query builders that own a database schema. Matched
 * segment-wise against the consumer's root `package.json` dependency keys, so
 * `@prisma/client` matches via `prisma` and `@mikro-orm/core` via `mikro-orm`.
 */
const ORM_PACKAGES = Object.freeze([
  'prisma',
  'drizzle-orm',
  'typeorm',
  'sequelize',
  'mongoose',
  'knex',
  'objection',
  'kysely',
  'mikro-orm',
  'bookshelf',
  'waterline',
]);

/** File extensions whose tracked presence implies a persistence schema. */
const PERSISTENCE_SCHEMA_EXTENSIONS = Object.freeze(['.sql', '.prisma']);

/** Directory basenames that name a schema-migrations directory. */
const MIGRATION_DIR_NAMES = Object.freeze(['migrations', 'migrate']);

/**
 * Parent directory basenames that qualify a `migrations`/`migrate` directory as
 * a **database** migrations directory rather than an unrelated one (e.g.
 * Mandrel's own `lib/migrations/` of framework-version upgrade steps). A
 * migrations directory only counts as a persistence marker when it sits under
 * one of these conventional ORM/database parents.
 */
const DB_MIGRATION_PARENTS = Object.freeze([
  'db',
  'database',
  'prisma',
  'drizzle',
  'supabase',
  'sql',
]);

/**
 * Process-lifetime memo for the filesystem half of the persistence probe,
 * keyed by project root — the persistence-layer analogue of
 * {@link _webSurfaceFsCache}.
 *
 * @type {Map<string, boolean>}
 */
const _persistenceFsCache = new Map();

/** Test-only: drop the memo so a fixture root can be re-probed after edits. */
export function _resetPersistenceLayerCache() {
  _persistenceFsCache.clear();
}

/**
 * True when the root `package.json` declares an ORM / query-builder dependency.
 * Tri-state contract per {@link declaresDependencyIn}; the fail-open caller
 * is {@link hasPersistenceLayer}.
 *
 * @param {string} root
 * @returns {boolean|null}
 */
function declaresOrmDependency(root) {
  return declaresDependencyIn(root, ORM_PACKAGES);
}

/**
 * True when a bounded scan of the source tree finds a persistence-schema
 * artifact: a tracked `.sql` / `.prisma` file, or a `migrations` / `migrate`
 * directory sitting under a conventional database parent (`db/`, `prisma/`, …).
 *
 * Unlike the web-asset scan, a truncated or completed no-find scan resolves to
 * **false** (not `null`): persistence artifacts live near the repo root by
 * convention, so a bounded near-root scan that does not find one is strong
 * evidence of absence — and it keeps a large ORM-less repo (Mandrel itself)
 * determinately not-applicable regardless of tree size. Only an unreadable
 * ROOT is indeterminate (`null`), which the caller fails open on.
 *
 * @param {string} root
 * @returns {boolean|null}
 */
function scanForPersistenceArtifacts(root) {
  let budget = WEB_SCAN_MAX_ENTRIES;
  const queue = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      if (dir === root) return null;
      continue;
    }

    for (const entry of entries) {
      if (budget-- <= 0) return false; // bounded near-root scan exhausted
      if (entry.isDirectory()) {
        if (WEB_SCAN_SKIP_DIRS.includes(entry.name)) continue;
        if (
          MIGRATION_DIR_NAMES.includes(entry.name) &&
          DB_MIGRATION_PARENTS.includes(path.basename(dir))
        ) {
          return true;
        }
        if (depth + 1 <= WEB_SCAN_MAX_DEPTH) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (PERSISTENCE_SCHEMA_EXTENSIONS.includes(path.extname(entry.name))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Decide whether the project has a **persistence layer** — the applicability
 * predicate behind the `target: "data-model"` gate in `audit-rules.json`
 * (Story #4633). The data-model lens reads ORM models, schema migrations, and
 * seed data; a project with none of those has nothing for it to inspect, so the
 * lens self-skips with an explicit not-applicable report rather than running to
 * empty findings.
 *
 * Like {@link hasWebSurface}, this is derived from observables in the
 * consumer's own checkout — Mandrel is materialized into other projects, so a
 * consumer with a real database MUST still get the lens. A project has a
 * persistence layer when ANY of these hold:
 *   1. The root `package.json` declares an ORM / query-builder dependency
 *      (prisma / drizzle / typeorm / sequelize / mongoose / knex / …).
 *   2. A bounded source scan finds a tracked `.prisma` / `.sql` schema file.
 *   3. A bounded source scan finds a `migrations` / `migrate` directory under a
 *      conventional database parent (`db/`, `prisma/`, `drizzle/`, …).
 *
 * **Fail direction: OPEN.** When the ORM-dependency signal is indeterminate —
 * an unparseable `package.json`, an unreadable root — the project is treated as
 * having a persistence layer, for the same reason as the web probe: a wasted
 * lens run is recoverable, silently dropped coverage is not. A determinate
 * "no ORM dependency + no schema artifact found" (Mandrel's own shape) is a
 * clean not-applicable.
 *
 * @param {{ config?: object|null, projectRoot?: string }} [params]
 * @returns {boolean}
 */
export function hasPersistenceLayer({ projectRoot = PROJECT_ROOT } = {}) {
  if (_persistenceFsCache.has(projectRoot)) {
    return _persistenceFsCache.get(projectRoot);
  }

  const declared = declaresOrmDependency(projectRoot);
  // `null` is indeterminate, not false — fail open.
  const result =
    declared === null || declared === true
      ? true
      : scanForPersistenceArtifacts(projectRoot) !== false;

  _persistenceFsCache.set(projectRoot, result);
  return result;
}

/**
 * Test a single filename against a single glob pattern using the project's
 * configured matcher semantics (`picomatch` with `dot: true`). Exported so
 * regression tests can pin engine behaviour without stubbing audit-rules.
 */
export function matchesFilePattern(pattern, file) {
  return picomatch(pattern, { dot: true })(file);
}

/**
 * Return true when any of `files` matches any of `patterns`.
 * Same semantics as `matchesFilePattern`; matchers are compiled once per call.
 */
export function matchesAnyFilePattern(patterns, files) {
  if (!patterns?.length || !files?.length) return false;
  const matchers = patterns.map((p) => picomatch(p, { dot: true }));
  return files.some((file) => matchers.some((m) => m(file)));
}

/** Extensions the sibling-test predicate treats as production source code. */
const SOURCE_CODE_EXTENSIONS = Object.freeze([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
]);

// biome-ignore lint/complexity/useRegexLiterals: constructor form keeps the MI walker able to score this module.
const TEST_FILE_RE = new RegExp(String.raw`\.(test|spec)\.[cm]?[jt]sx?$`);
// biome-ignore lint/complexity/useRegexLiterals: constructor form keeps the MI walker able to score this module.
const TEST_DIR_RE = new RegExp(
  '(^|/)(tests?|__tests__|spec|e2e|__mocks__)(/|$)',
);
// biome-ignore lint/complexity/useRegexLiterals: constructor form keeps the MI walker able to score this module.
const CODE_EXT_RE = new RegExp(String.raw`\.[cm]?[jt]sx?$`);

/**
 * True when `file` is a test/spec file — either by the `.test.` / `.spec.`
 * infix or by living under a conventional test directory.
 *
 * @param {string} file
 * @returns {boolean}
 */
function isTestFile(file) {
  return TEST_FILE_RE.test(file) || TEST_DIR_RE.test(file);
}

/**
 * The sibling stem of a path: its basename with any `.test` / `.spec` infix and
 * the code extension stripped (`src/foo.test.js` and `src/foo.js` both → `foo`).
 *
 * @param {string} file
 * @returns {string}
 */
function stemOf(file) {
  const base = file.split('/').pop() ?? file;
  return base.replace(TEST_FILE_RE, '').replace(CODE_EXT_RE, '');
}

/**
 * The coverage-gap routing predicate behind the `sourceWithoutSiblingTest`
 * trigger (Story #4628): a change set warrants the `audit-quality` lens when it
 * touches at least one **production source** file whose **sibling test is not
 * also in the change set**. This flips the historical (backwards) trigger that
 * fired the coverage-gap detector on test-file changes — a diff that only edits
 * tests has, if anything, *more* coverage, not less; the risk lives in source
 * that shipped without a matching test.
 *
 * A source file's sibling is matched by stem (`src/foo.js` ↔ any changed
 * `foo.test.js` / `foo.spec.js`, regardless of directory). Test-only diffs,
 * doc/config-only diffs, and source diffs whose every file has a sibling test
 * in the same change set all return `false` and route no quality lens.
 *
 * Pure over its input; no git, no disk.
 *
 * @param {string[]|null|undefined} changedFiles
 * @returns {boolean}
 */
export function changeSetLacksSiblingTest(changedFiles) {
  const files = (Array.isArray(changedFiles) ? changedFiles : []).filter(
    (f) => typeof f === 'string' && f.length > 0,
  );
  const testStems = new Set(
    files.filter((f) => isTestFile(f)).map((f) => stemOf(f)),
  );
  const sources = files.filter(
    (f) => !isTestFile(f) && SOURCE_CODE_EXTENSIONS.includes(path.extname(f)),
  );
  return sources.some((src) => !testStems.has(stemOf(src)));
}

/**
 * Filter audits based on logic in audit-rules.json (validated against
 * audit-rules.schema.json).
 *
 * @param {object} params
 * @param {number} params.ticketId
 * @param {string} params.gate
 * @param {import('../ITicketingProvider.js').ITicketingProvider} params.provider
 * @param {string[]} [params.changedFiles]
 *   The change set to select over, when the caller already knows it. Supplying
 *   it skips the internal `git diff` entirely and `baseBranch` / `headRef` are
 *   then unused. Callers whose change set is NOT the working tree's
 *   `baseBranch...headRef` MUST pass this: the plan-run epilogue runs from the
 *   main checkout *after* its Stories have merged, where any `main...HEAD`
 *   range is empty by construction and selection would silently degrade to
 *   keyword-only matching (Story #4571). An empty array is honoured as
 *   "the set is known, and it is empty" — distinct from omitting the option,
 *   which means "derive it from git".
 * @param {string} [params.baseBranch]
 * @param {string} [params.headRef]
 *   Git ref whose diff-against-`baseBranch` defines the change set. Defaults
 *   to `HEAD` (the working-copy tip) for ticket-scoped callers. Epic-mode
 *   callers MUST pass the requested Epic's own branch ref (e.g.
 *   `refs/heads/epic/<id>`) so the change set is pinned to that Epic's branch
 *   rather than whatever HEAD the shared checkout happens to sit on. Under two
 *   concurrent `/mandrel-deliver` runs sharing one checkout, diffing against
 *   `HEAD` silently resolves the *other* Epic's change set (Story #3362). When
 *   `headRef` cannot be resolved in the repo, the selector returns a
 *   `degraded: true` envelope (or hard-fails in gate-mode) instead of diffing
 *   the wrong tree.
 * @param {(cwd: string, ...args: string[]) => Promise<{status:number, stdout:string, stderr:string}>} [params.injectedGitSpawn]
 *   Test-only seam. Production callers leave unset; the real (synchronous) `gitSpawn`
 *   is wrapped in `Promise.resolve` so `withTimeout` can still race it. Tests can
 *   inject a promise that never resolves to exercise the ETIMEDOUT fallback.
 * @param {number} [params.gitTimeoutMsOverride]
 *   Test-only seam to shrink the git-spawn timeout below the configured default
 *   (which is 30_000 ms) so timeout tests don't stall the suite.
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv }} [params.gateModeOpts]
 *   Test-only seam to drive the `--gate-mode` / `MANDREL_GATE_MODE=1`
 *   detection; production callers leave unset and `isGateMode` reads
 *   `process.argv` / `process.env`.
 * @param {typeof hasWebSurface} [params.hasWebSurfaceFn]
 *   Test-only seam overriding the web-surface probe behind the
 *   `target: "web"` applicability gate. Production callers leave unset.
 *
 * Returns either the success envelope (`{ selectedAudits, ticketId, gate, context }`)
 * OR the degraded envelope (`{ ok: false, degraded: true, reason, detail }`)
 * when the git-diff probe times out OR `headRef` cannot be resolved and
 * gate-mode is unset. In gate-mode, the same conditions throw.
 */
export async function selectAudits({
  ticketId,
  gate,
  provider,
  changedFiles: injectedChangedFiles,
  baseBranch = 'main',
  headRef = 'HEAD',
  injectedGitSpawn,
  gitTimeoutMsOverride,
  gateModeOpts,
  hasWebSurfaceFn = hasWebSurface,
  hasPersistenceLayerFn = hasPersistenceLayer,
}) {
  const config = resolveConfig();
  const timeoutMs = gitTimeoutMsOverride ?? DEFAULT_GIT_TIMEOUT_MS;
  const rulesData = await loadAuditRules(config);

  const ticket = await provider.getTicket(ticketId);
  const contentToSearch = ticketSearchText(ticket);

  const runGit = injectedGitSpawn ?? (async (...args) => gitSpawn(...args));

  // A caller that already knows the change set supplies it, and no git ref is
  // consulted at all — `baseBranch` / `headRef` describe a diff that is not
  // being taken. The plan-run epilogue is the motivating caller (Story #4571):
  // it resolves the run's landed diff from the Stories' squash-merges, and any
  // `main...HEAD` range it could name from the main checkout post-land is
  // empty by construction.
  const hasInjectedChangedFiles = Array.isArray(injectedChangedFiles);

  if (!hasInjectedChangedFiles && headRef !== 'HEAD') {
    const degraded = await resolveHeadRefOrDegrade({
      runGit,
      headRef,
      timeoutMs,
      gateModeOpts,
    });
    if (degraded) return degraded;
  }

  let changedFiles;
  if (hasInjectedChangedFiles) {
    changedFiles = injectedChangedFiles
      .map((f) => String(f).trim())
      .filter(Boolean);
  } else {
    const acquired = await acquireChangedFilesFromDiff({
      runGit,
      baseBranch,
      headRef,
      timeoutMs,
      gateModeOpts,
    });
    if (acquired.degraded) return acquired.degraded;
    changedFiles = acquired.files;
  }

  const selectedAudits = matchAuditRules({
    audits: rulesData.audits ?? {},
    gate,
    contentToSearch,
    changedFiles,
    projectSupportsTarget: makeTargetApplicabilityProbe({
      config,
      hasWebSurfaceFn,
      hasPersistenceLayerFn,
    }),
  });

  return {
    selectedAudits,
    ticketId,
    gate,
    context: {
      // Full file list, exposed so Epic-mode callers (e.g. epic-audit) can
      // pass it through as the {{changedFiles}} substitution value. Existing
      // callers that read only `changedFilesCount` remain unaffected.
      changedFiles,
      changedFilesCount: changedFiles.length,
      // The ref the change set was actually diffed against. Epic-mode callers
      // assert this matches the requested Epic branch (Story #3362) so a
      // mis-pinned diff never reaches the audit-lens selector silently. `null`
      // on the injected path: no ref was diffed, and naming one would invite
      // exactly that assertion to pass against a diff nobody took.
      resolvedRef: hasInjectedChangedFiles ? null : headRef,
      ticketTitle: ticket.title,
    },
  };
}

/**
 * Read and parse `audit-rules.json` from the configured schemas root.
 *
 * @param {object} config Resolved `.agentrc.json` wrapper.
 * @returns {Promise<object>}
 */
async function loadAuditRules(config) {
  const rulesPath = path.join(
    PROJECT_ROOT,
    getPaths(config).schemasRoot,
    'audit-rules.json',
  );
  try {
    return JSON.parse(await fs.readFile(rulesPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read audit-rules from ${rulesPath}: ${err.message}`,
    );
  }
}

/** Lower-cased ticket text the keyword triggers match against. */
function ticketSearchText(ticket) {
  return `${ticket.title || ''} ${ticket.body || ''}`.toLowerCase();
}

/**
 * Resolve a non-default `headRef` to a commit before diffing. A ref the repo
 * cannot resolve means the requested branch is not present in this checkout —
 * diffing `baseBranch...HEAD` would silently report a *different* change set
 * (Story #3362) — so that surfaces as an explicit degraded signal instead of
 * leaking the wrong scope. Returns `null` when the ref resolves; otherwise
 * the degraded envelope from `softFailOrThrow` (which throws in gate-mode).
 * A non-timeout spawn failure propagates.
 *
 * @param {{ runGit: Function, headRef: string, timeoutMs: number, gateModeOpts?: object }} params
 * @returns {Promise<object|null>}
 */
async function resolveHeadRefOrDegrade({
  runGit,
  headRef,
  timeoutMs,
  gateModeOpts,
}) {
  let resolved;
  try {
    resolved = await withTimeout(
      runGit(process.cwd(), 'rev-parse', '--verify', '--quiet', headRef),
      timeoutMs,
      { label: 'select-audits rev-parse headRef' },
    );
  } catch (err) {
    if (err?.code === 'ETIMEDOUT') {
      return softFailOrThrow(
        'GIT_DIFF_TIMEOUT',
        `select-audits: git rev-parse ${headRef} timed out after ${timeoutMs} ms`,
        gateModeOpts,
      );
    }
    throw err;
  }
  if (resolved?.status !== 0 || !resolved.stdout.trim()) {
    return softFailOrThrow(
      'HEAD_REF_UNRESOLVED',
      `select-audits: requested ref '${headRef}' could not be resolved in this checkout; refusing to diff against a phantom change set`,
      gateModeOpts,
    );
  }
  return null;
}

/**
 * Acquire the change set from `git diff --name-only base...head`. Returns
 * `{ files }` on success — a diff that exits non-zero yields an empty list,
 * preserving the pre-extraction flow — or `{ degraded }` with the soft-fail
 * envelope on timeout. A non-timeout spawn failure propagates.
 *
 * @param {{ runGit: Function, baseBranch: string, headRef: string, timeoutMs: number, gateModeOpts?: object }} params
 * @returns {Promise<{ files?: string[], degraded?: object }>}
 */
async function acquireChangedFilesFromDiff({
  runGit,
  baseBranch,
  headRef,
  timeoutMs,
  gateModeOpts,
}) {
  let diff;
  try {
    diff = await withTimeout(
      runGit(
        process.cwd(),
        'diff',
        '--name-only',
        `${baseBranch}...${headRef}`,
      ),
      timeoutMs,
      { label: 'select-audits git diff' },
    );
  } catch (err) {
    if (err?.code === 'ETIMEDOUT') {
      // Soft-fail contract (Tech Spec #819): in default mode, return a
      // degraded envelope so the caller sees the explicit signal instead of
      // silently falling through to keyword-only matching. In gate-mode,
      // hard-fail closed.
      return {
        degraded: softFailOrThrow(
          'GIT_DIFF_TIMEOUT',
          `select-audits: git diff against ${baseBranch} timed out after ${timeoutMs} ms`,
          gateModeOpts,
        ),
      };
    }
    throw err;
  }
  if (diff?.status !== 0) return { files: [] };
  return {
    files: diff.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean),
  };
}

/**
 * Whole-word keyword match over the ticket's search text: a bare substring
 * test selects lenses on accidental fragments ("ui" inside "requires",
 * "auth" inside "author" — #4579).
 *
 * @param {string[]} keywords
 * @param {string} content Lower-cased ticket text.
 * @returns {boolean}
 */
function matchesAnyKeyword(keywords, content) {
  return keywords.some((kw) => {
    const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(content);
  });
}

/**
 * Build the once-per-call target-applicability probe. Probes resolve at most
 * once per target, and only if a lens declaring that target actually clears
 * its gate — a Node-only project must not pay a filesystem scan on a roster
 * with no `web` lens in it, nor a DB-less project pay one for `data-model`.
 *
 * @param {{ config: object, hasWebSurfaceFn: Function, hasPersistenceLayerFn: Function }} params
 * @returns {(target: string) => boolean}
 */
function makeTargetApplicabilityProbe({
  config,
  hasWebSurfaceFn,
  hasPersistenceLayerFn,
}) {
  const probes = {
    web: hasWebSurfaceFn,
    'data-model': hasPersistenceLayerFn,
  };
  const memo = new Map();
  return (target) => {
    if (!memo.has(target)) {
      const probe = probes[target];
      memo.set(target, probe ? probe({ config }) : true);
    }
    return memo.get(target);
  };
}

/**
 * True when any of a lens's content triggers fires against the change set:
 * whole-word keywords, file-pattern globs, or the coverage-gap
 * `sourceWithoutSiblingTest` predicate (#4628).
 *
 * @param {object} triggers The lens's `triggers` block.
 * @param {string} contentToSearch Lower-cased ticket text.
 * @param {string[]} changedFiles
 * @returns {boolean}
 */
function lensTriggerFires(triggers, contentToSearch, changedFiles) {
  return (
    matchesAnyKeyword(triggers.keywords || [], contentToSearch) ||
    matchesAnyFilePattern(triggers.filePatterns || [], changedFiles) ||
    (triggers.sourceWithoutSiblingTest === true &&
      changeSetLacksSiblingTest(changedFiles))
  );
}

/**
 * Run the audit-rules matching loop over one gate's roster: a lens is
 * selected when its gate matches, its `target` applicability gate passes,
 * and any of its keyword / file-pattern / sibling-test triggers fires.
 *
 * @param {{
 *   audits: Record<string, object>,
 *   gate: string,
 *   contentToSearch: string,
 *   changedFiles: string[],
 *   projectSupportsTarget: (target: string) => boolean,
 * }} params
 * @returns {string[]} Selected lens identifiers, in manifest order.
 */
function matchAuditRules({
  audits,
  gate,
  contentToSearch,
  changedFiles,
  projectSupportsTarget,
}) {
  const selectedAudits = [];
  for (const [auditName, ruleOpts] of Object.entries(audits)) {
    const triggers = ruleOpts.triggers || {};

    if (!triggers.gates?.includes(gate)) continue;

    // Target-applicability gate (#4579, #4633). A lens declaring a `target`
    // has nothing to read on a project lacking that surface, yet still
    // whole-word-matches ordinary prose — `audit-seo` fires on the `meta`
    // inside every Story body's `<!-- meta: {...} -->` machine comment. The
    // roster's own instruction is that the host MUST walk every listed lens,
    // so an inapplicable entry is not just wasted spend: it teaches operators
    // to ignore the MUST. An absent `target` (or `any`) means "always
    // applicable", so no existing lens changes behaviour.
    const { target } = ruleOpts;
    if (target && target !== 'any' && !projectSupportsTarget(target)) continue;

    if (lensTriggerFires(triggers, contentToSearch, changedFiles)) {
      selectedAudits.push(auditName);
    }
  }
  return selectedAudits;
}
