/**
 * phases/authoring-context.js — emit-context phase.
 *
 * Builds the authoring context the host LLM (or the
 * `/plan` author step) needs to write the Tech Spec.
 * Returns a plain JSON-serialisable object; never hits the network beyond
 * the provider call needed to load the Epic.
 */

import * as os from 'node:os';
import path from 'node:path';
import {
  resolveFeatureRoots,
  verifyBddRunnerPendingTag,
} from '../../bdd-runner-detect.js';
import { scanBddScenarios } from '../../bdd-scenario-scanner.js';
import { getPaths, PROJECT_ROOT } from '../../config-resolver.js';
import { scanMemoryFreshness } from '../../feedback-loop/memory-freshness.js';
import { fetchPriorFeedback } from '../../feedback-loop/prior-feedback-fetcher.js';
import { Logger } from '../../Logger.js';
import { hasTicketSection } from '../../ticket-body-sections.js';
import { ensureDocsDigest } from '../docs-digest.js';

/**
 * Resolve the per-project memory directory used by the memory-freshness
 * pre-flight (Story #2557 / Epic #2547).
 *
 * Resolution order:
 *   1. `MANDREL_MEMORY_DIR` environment variable (test seam and operator
 *      override).
 *   2. `~/.claude/projects/<repo>/memory/` — the standard Claude Code
 *      memory substrate path, scoped by the configured GitHub repo so each
 *      consumer project gets its own memory pool.
 *   3. `null` when neither is resolvable. The scanner tolerates a missing
 *      `memoryDir` and surfaces a single `errors[]` entry.
 *
 * @param {{ github?: { owner?: string, repo?: string }|null }} opts
 * @returns {string|null}
 */
function resolveMemoryDir({ github } = {}) {
  if (
    typeof process.env.MANDREL_MEMORY_DIR === 'string' &&
    process.env.MANDREL_MEMORY_DIR.length > 0
  ) {
    return process.env.MANDREL_MEMORY_DIR;
  }
  const repo = github?.repo;
  if (typeof repo !== 'string' || repo.length === 0) return null;
  return path.join(os.homedir(), '.claude', 'projects', repo, 'memory');
}

/**
 * Build the digest-first `docsContext` envelope field (Story #4433 — hard
 * cutover of the § 3.1 planning read contract to digest-first with
 * pull-on-demand, mirroring the Story #4324 delivery-children cutover).
 *
 * Ensures a docs digest exists at the **same** per-Epic temp path the
 * `/deliver` story sub-agents already consume
 * (`<tempRoot>/epic-<seedIssueId>/docs-digest.md`) via the shared
 * `ensureDocsDigest` export in `docs-digest.js` — one generator, one file,
 * reused across the planning and delivery surfaces for the same Epic. The
 * envelope carries only the digest path, not embedded doc content; the
 * planner (host LLM driving the `/plan` author step) reads the digest
 * and pulls a full file/section on demand when it bears on the decision.
 *
 * Returns `null` — a silent no-op — when `project.docsContextFiles` is not
 * configured. There is no scrape-every-markdown-under-docsRoot fallback for
 * planning; that fallback remains a `doc-reader.js` primitive used
 * elsewhere, not part of this envelope.
 *
 * @param {{ seedIssueId: number, settings: object, cwd: string }} args
 * @returns {Promise<{ mode: 'digest', digestPath: string } | null>}
 */
async function buildPlanningDocsContext({ seedIssueId, settings, cwd }) {
  const docsContextFiles = Array.isArray(settings?.docsContextFiles)
    ? settings.docsContextFiles
    : [];
  if (docsContextFiles.length === 0) return null;

  const paths = getPaths({ project: { paths: settings?.paths } });
  const docsRoot = path.resolve(cwd, paths.docsRoot);
  const relPath = path.join(
    paths.tempRoot,
    `epic-${seedIssueId}`,
    'docs-digest.md',
  );
  const absPath = path.resolve(cwd, relPath);

  const result = await ensureDocsDigest({
    docsContextFiles,
    docsRoot,
    outputPath: absPath,
  });
  if (!result) return null;
  return { mode: 'digest', digestPath: relPath };
}

/**
 * Build the authoring context the host LLM (or the
 * `/plan` author step) needs to write the Tech Spec.
 *
 * `docsContext` is digest-first (Story #4433): a pointer at the per-Epic
 * docs digest rather than embedded doc content, `null` when
 * `project.docsContextFiles` is unset.
 *
 * The body carried here is **unbounded**. Story #4541 removed the
 * `applyBudget` pass (and the `--full-context` flag that toggled it): both
 * `plan-context.js` envelope builders discard this `epic` field entirely and
 * ship the raw seed on `seed.content` instead, so the budget bounded nothing
 * that shipped and the flag was a no-op. The raw-seed passthrough is
 * deliberate and test-pinned; the budget pass was the orphan. Envelope size
 * is guarded where it is actually decided — `PLAN_CONTEXT_ENVELOPE_BYTE_CEILING`
 * in `lib/orchestration/plan-context.js`.
 */
export async function buildAuthoringContext(
  seedIssueId,
  provider,
  settings = {},
  opts = {},
) {
  // Epic #4474 (M3 PR2): `opts.epic` is an optional prefetched Epic object
  // so a caller that already holds the issue (the folded `plan-context.js`
  // envelope build, which also needs the raw body for clarity scoring and
  // re-plan detection) does not pay a second provider fetch. Absent, the
  // fetch behaviour is unchanged.
  const epic = opts.epic ?? (await provider.getEpic(seedIssueId));
  if (!epic) {
    throw new Error(`Epic #${seedIssueId} not found.`);
  }

  const { cwd = PROJECT_ROOT } = opts;

  const docsContext = await buildPlanningDocsContext({
    seedIssueId: epic.id,
    settings,
    cwd,
  });

  // Story #2094 Task #2103 — verify the project's BDD runner pending-tag
  // support so the acceptance-spec body can record either the verified tag
  // (features-first ordering) or "fallback: dependencies-first ordering"
  // when no supported runner is present.
  const bddRunner = await verifyBddRunnerPendingTag({ cwd: PROJECT_ROOT });

  // Story #2637 — index existing BDD scenarios so the Acceptance Engineer
  // step can annotate planned ACs with matches from the project's
  // `.feature` files. Empty array when the project has not adopted BDD;
  // the scanner is best-effort and never throws on filesystem errors.
  let bddScenarios = [];
  try {
    const featureRoots = resolveFeatureRoots({ cwd: PROJECT_ROOT });
    bddScenarios = scanBddScenarios({ featureRoots });
  } catch (err) {
    Logger.warn(`[plan-context] BDD scenario scan skipped: ${err.message}`);
  }

  // Story #2557 — memory-freshness pre-flight runs BEFORE the prior-feedback
  // fetch so the planner sees a deduplicated, currently-actionable memory
  // store. The scanner is best-effort: missing memory dir or gh-CLI failures
  // land in `memoryFreshness.errors[]` and never throw.
  const githubCfg = opts.github ?? null;
  const memoryDir = resolveMemoryDir({ github: githubCfg });
  const memoryFreshness = await scanMemoryFreshness({
    memoryDir,
    owner: githubCfg?.owner,
    repo: githubCfg?.repo,
    projectRoot: PROJECT_ROOT,
  });

  // Story #2554 — surface open meta feedback issues to the planner so retro
  // signals are routed into durable substrates rather than lost in chat.
  // The fetcher is best-effort: missing owner/repo or gh-CLI failures land
  // in `errors[]` and never throw.
  const priorFeedback = await fetchPriorFeedback({
    owner: githubCfg?.owner,
    repo: githubCfg?.repo,
  });

  // Story #4811 — the codebase snapshot (#2634), its authoring grounding
  // (#4139 F10) and the spec-freshness helpers behind it are retired. The
  // pre-computed structural view grounded nothing it promised: the default
  // include globs missed the standard monorepo layout outright, its remedies
  // pointed at knobs that re-filtered the same set, and its cited-but-absent
  // signal inverted into noise whenever the snapshot was the thing that was
  // wrong. Grounding now rests on the two mechanisms that read the real tree:
  // the authoring model's own targeted retrieval (the digest-first precedent
  // of Story #4433) and the Phase 8 `validateStoryFileAssumptions` gate, which
  // probes every authored `{path, assumption}` against the working tree as a
  // hard error. Nothing pre-computed replaces it — a stale inventory is the
  // failure mode, not the fix.

  // Story #4542 — planning authors no risk artifact at all. Review depth and
  // the acceptance-critic mode are derived from the diff at close time
  // (`review-depth.js#deriveChangeLevel`), so there is nothing to classify
  // here and nothing for the author step to judge about itself.

  return {
    epic: {
      id: epic.id,
      title: epic.title,
      body: epic.body ?? null,
      // Story #4324: the context-ticket classes are retired. A re-planned
      // Epic's previous Tech Spec / Acceptance Table content rides along
      // inside `body` (managed sections), which is how the author keeps
      // AC IDs stable across re-plans.
      planningSections: {
        techSpec: hasTicketSection(epic.body ?? '', 'techSpec'),
        acceptanceTable: hasTicketSection(epic.body ?? '', 'acceptanceTable'),
      },
    },
    docsContext,
    bddRunner,
    bddScenarios,
    memoryFreshness,
    priorFeedback,
  };
}
