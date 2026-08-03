/**
 * plan-context.js — single planner-context envelope build for `/plan`.
 *
 * Folds the authoring-context builders plus the cross-Story dup search into
 * ONE JSON envelope, so the authoring middle reads a single file instead of
 * shim-scripting library imports.
 *
 * Two operator modes (v2 Story-only):
 *   - `seed` / `seed-file` — freeform text (chat or on-disk). Carries
 *     `seed` plus `duplicates[]` (open-Story dup search).
 *   - `tickets` — one or more existing issue ids to analyze into proper
 *     Stories. Carries `sourceTickets[]` plus `duplicates[]` (excluding
 *     the source ids themselves).
 *
 * All fields are JSON-serialisable; the module performs no GitHub writes.
 * The only I/O surfaces are the injected `provider` (reads) and the
 * best-effort local scans the folded builders already perform.
 */

import { readFile } from 'node:fs/promises';
import { readAuditRulesSync } from '../audit-suite/audit-rules-reader.js';
import {
  hasWebSurface,
  matchesAnyFilePattern,
} from '../audit-suite/selector.js';
import { getLimits } from '../config-resolver.js';
import { findSimilarOpenStories } from '../duplicate-search.js';
import { Logger } from '../Logger.js';
import { parse as parseStoryBody } from '../story-body/story-body.js';
import {
  renderAcceptanceSpecSystemPrompt,
  renderTechSpecSystemPrompt,
} from '../templates/spec-author-prompts.js';
import { concurrentMap, FANOUT_CONCURRENCY } from '../util/concurrent-map.js';
import { buildComplexitySignals } from './complexity-gate.js';
import { parseDeliverySlicingTable } from './consolidation-precondition.js';
import { buildDocsDigest } from './docs-digest.js';
import { buildAuthoringContext } from './planning/authoring-context.js';
import { buildDecomposerSystemPrompt } from './planning/decomposer-context.js';

/**
 * Envelope byte ceiling (regression guard for the design's named PR2 risk:
 * two envelopes → one bigger one). This is the **only** live bound on
 * envelope size: Story #4541 removed the `applyBudget` pass from
 * `buildAuthoringContext`, because both builders below discard that budgeted
 * body and ship the raw seed on `seed.content` instead — the budget bounded
 * a field that never left the function.
 *
 * A measured seed-mode envelope on this repo (a thin `.feature` corpus) is
 * ~120 KB, dominated by the digest-first `docsContext` (~63 KB inline
 * digest) and the rendered `systemPrompts` (~54 KB); every other field is
 * under 1 KB. Story #4811 retired the tier-capped codebase snapshot that
 * used to sit alongside them (~35 KB skinny here). This measurement is
 * **not** representative of every consumer, though: Story #4977 found
 * `bddScenarios` at 118 KB on a consumer with a mature Gherkin corpus —
 * larger than `docsContext` and `systemPrompts` combined, consuming nearly
 * all of the ceiling's headroom on its own, because the scanner applied no
 * cap. `bddScenarios` is now truncated to `BDD_SCENARIOS_BYTE_BUDGET`
 * (`lib/bdd-scenario-budget.js`, ≤24 KB) before it reaches this envelope,
 * so the seed remains the only field this ceiling leaves genuinely
 * unbounded. 256 KB (~64K tokens at the ≈4-chars/token estimate) leaves
 * roughly 2× headroom over the fixed-floor measurement above while staying
 * well under the session budget. The test suite asserts serialized
 * envelopes stay under this value — raise it only with a measured
 * justification.
 */
export const PLAN_CONTEXT_ENVELOPE_BYTE_CEILING = 256_000;

/** Fields named in the over-ceiling error, to point at what to trim. */
const OVERSIZE_REPORT_FIELDS = 3;

/**
 * Per-field remedy for the over-ceiling refusal, keyed by envelope field
 * name. Story #4977 — the refusal used to hardcode "trim the seed, or plan
 * fewer --tickets" regardless of which field actually blew the budget; on a
 * consumer with a mature Gherkin corpus the dominant field was
 * `bddScenarios` (repo-derived, not seed-derived), and "trim the seed" was a
 * dead lever the operator had no way to act on. The remedy now follows the
 * single largest field.
 */
const OVERSIZE_FIELD_REMEDIES = Object.freeze({
  seed: 'Trim the seed text — it is carried verbatim by design and is the one field with no elision path.',
  sourceTickets:
    'Plan fewer --tickets source issues in one run — each source ticket body is carried verbatim.',
  epic: 'Plan fewer --tickets source issues in one run, or re-plan with a shorter Epic body.',
  bddScenarios:
    "The project's .feature corpus is already capped near BDD_SCENARIOS_BYTE_BUDGET (lib/bdd-scenario-budget.js) — if this still dominates, another field is unusually small; check the full field breakdown.",
  docsContext:
    'Trim project.docsContextFiles — docsContext is a digest built from those files.',
  systemPrompts:
    'This field is a fixed framework prompt, not operator content — if it dominates, file a framework-gap issue rather than trying to trim it.',
});

const DEFAULT_OVERSIZE_REMEDY =
  'Trim the seed, or plan fewer --tickets source issues in one run.';

/**
 * Fail closed when an assembled envelope exceeds
 * {@link PLAN_CONTEXT_ENVELOPE_BYTE_CEILING}.
 *
 * Until now the ceiling was enforced *only* by a test assertion over this
 * repo's own fixtures, which bounds nothing at runtime: the value it actually
 * has to hold for is a consumer's seed or `--tickets` source bodies, and no
 * test sees those. That left the documented planner-context cap resting
 * entirely on `planning.context.maxBytes` — which resolved but was wired to
 * nothing (its `applyBudget` pass lost its last caller in the v2 cutover), so
 * in practice no bound existed at all on the path that needed one. That key
 * and its budget module were removed outright in Story #4541; this ceiling is
 * the replacement.
 *
 * Failing closed is the right direction here and matches how an over-budget
 * `## Spec` is handled (`spec-spill.js`): an envelope this size does not
 * degrade the planner gracefully, it silently produces garbage Stories from a
 * truncated-by-the-host context. Better to refuse and say what to trim. The
 * bound is deliberately a fixed framework constant rather than an operator
 * knob — a cap the operator can raise past what the model can read is a cap
 * that fails silently again.
 *
 * Deliberately **not** exported: its only external caller would be a test, and
 * a test-only export is a production-dead one. It is reachable end to end
 * through {@link buildPlanContext}, which is where the behaviour matters.
 *
 * @param {object} envelope
 * @param {{ ceiling?: number }} [opts]
 * @returns {object} `envelope`, unchanged, when it fits.
 */
function assertPlanContextWithinCeiling(envelope, opts = {}) {
  const ceiling = opts.ceiling ?? PLAN_CONTEXT_ENVELOPE_BYTE_CEILING;
  const bytes = Buffer.byteLength(JSON.stringify(envelope) ?? '', 'utf-8');
  if (bytes <= ceiling) return envelope;

  const sortedFields = Object.entries(envelope)
    .map(([field, value]) => [
      field,
      Buffer.byteLength(JSON.stringify(value) ?? '', 'utf-8'),
    ])
    .sort((a, b) => b[1] - a[1]);

  const largest = sortedFields
    .slice(0, OVERSIZE_REPORT_FIELDS)
    .map(([field, size]) => `${field} (${Math.round(size / 1024)} KB)`)
    .join(', ');

  const topField = sortedFields[0]?.[0];
  const remedy = OVERSIZE_FIELD_REMEDIES[topField] ?? DEFAULT_OVERSIZE_REMEDY;

  throw new Error(
    `[plan-context] the assembled "${envelope?.mode}" envelope is ` +
      `${Math.round(bytes / 1024)} KB, over the ` +
      `${Math.round(ceiling / 1024)} KB planner-context ceiling. Largest ` +
      `fields: ${largest}. ${remedy} Raising the ceiling needs a measured ` +
      'justification — see PLAN_CONTEXT_ENVELOPE_BYTE_CEILING.',
  );
}

/**
 * Compact, machine-readable descriptor of the `tickets.json` array the
 * authoring pass writes and `validateAndNormalizeTickets` gates at persist
 * time. A descriptor, not a validator: the deterministic gate stays in the
 * persist half (design § 1 step 3); this field exists so the authoring
 * middle knows the shape without re-reading the decomposer prompt prose.
 */
export const TICKET_SCHEMA_DESCRIPTOR = Object.freeze({
  shape: 'array',
  itemFields: Object.freeze({
    slug: 'string — ^[a-z0-9][a-z0-9-]*$ (hyphen-case, unique per decompose)',
    type: "string — literal 'story' (2-tier hierarchy: Epic → Story only)",
    title: 'string — short descriptive title',
    body: 'string — serialized Story-body markdown (never a JSON object); omit the ## Acceptance / ## Verify sections, persist syncs them in',
    acceptance:
      'string[] — top-level testable criteria; the machine contract, authored here and not in the body',
    verify:
      'string[] — top-level exact commands/test paths with (<tier>); the machine contract, authored here and not in the body',
    labels:
      "string[]? — extra labels to apply; 'type::story' is applied automatically. agent::*, type::*, and persona::* are rejected (runtime-owned or retired axes)",
    depends_on: 'string[]? — sibling Story slugs that block execution',
  }),
  validatedBy:
    'validateAndNormalizeTickets (lib/orchestration/ticket-validator.js) at persist time',
});

/**
 * Filename of the ready-to-fill Story authoring template `plan-context.js`
 * writes next to the captured envelope (Story #4707).
 */
export const STORIES_TEMPLATE_FILENAME = 'stories.template.json';

/**
 * Build the template's `changes[]` entries from the envelope's advisory
 * complexity signals (Story #4723). Each seed-predicted path is
 * pre-resolved to its creates-vs-refactors assumption against the repo
 * snapshot the signals already probed: a path present in the repo is a
 * `refactors-existing`, a missing one is a `creates`. Order follows
 * `predictedPaths` (first appearance in the seed). Falls back to the
 * single instructive placeholder entry when the seed predicted no paths.
 *
 * @param {{
 *   predictedPaths?: string[],
 *   repoState?: { existingPaths?: string[], missingPaths?: string[] },
 * }|null|undefined} complexitySignals
 * @returns {Array<{ path: string, assumption: string }>}
 */
function buildTemplateChanges(complexitySignals) {
  const predicted = Array.isArray(complexitySignals?.predictedPaths)
    ? complexitySignals.predictedPaths.filter(
        (p) => typeof p === 'string' && p.length > 0,
      )
    : [];
  if (predicted.length === 0) {
    return [{ path: 'path/to/file.ext', assumption: 'refactors-existing' }];
  }
  const existing = new Set(
    Array.isArray(complexitySignals?.repoState?.existingPaths)
      ? complexitySignals.repoState.existingPaths
      : [],
  );
  return predicted.map((path) => ({
    path,
    assumption: existing.has(path) ? 'refactors-existing' : 'creates',
  }));
}

/**
 * Render the ready-to-fill `stories.json` authoring template (Story #4707).
 *
 * One-shot authoring: the planner copies this file to `stories.json`, fills
 * the placeholder values, and runs persist — no step requires reading
 * `story-body.js` source or re-poking the envelope for format discovery
 * (bench: ~7 of 17 plan turns were format discovery). The template uses the
 * **structured-object body** shape, which persist parses and serializes to
 * the canonical markdown itself (`parse` accepts an object;
 * `assembleOnePlanStory` re-serializes canonically), so the serializer
 * contract never has to be reverse-engineered by the author. `acceptance[]`
 * / `verify[]` live at the ticket's top level — the machine contract persist
 * syncs into the body.
 *
 * Correct-by-construction skeleton (Story #4723): the emitted `verify[]`
 * placeholder already ends with a valid `(tier)` tag (swap `(unit)` for
 * `(contract)` / `(e2e)` / `(validate)` where appropriate), and when the
 * envelope's `complexitySignals` predicted a footprint the `changes[]`
 * entries arrive pre-resolved to creates-vs-refactors against the repo
 * snapshot — a faithfully-filled skeleton passes the persist ticket
 * validators without a mechanical round-trip. The persist gates stay
 * authoritative (they probe the base branch ref, not the working tree).
 *
 * Pure and deterministic; the output is valid JSON (parseable as-is), with
 * instructive placeholder values rather than comments.
 *
 * @param {{ complexitySignals?: object|null }} [opts] Envelope signals to
 *   pre-resolve the skeleton against; omit for the bare placeholder shape.
 * @returns {string} Pretty-printed JSON template content.
 */
export function renderStoriesTemplate({ complexitySignals = null } = {}) {
  const template = [
    {
      slug: 'fill-hyphen-case-slug',
      type: 'story',
      title: 'Fill: short descriptive title',
      body: {
        goal: 'Fill: one sentence stating why this Story exists.',
        spec:
          'Optional — contract and invariants only: interfaces, status ' +
          'codes, security invariants, and load-bearing constraints with ' +
          'their why. Implementation choices belong to the deliverer unless ' +
          'load-bearing. No per-file behavior paragraphs, no current-state ' +
          'narration. Aim for ~250 words; an advisory warning fires past 350, ' +
          'and it never fails the persist. ' +
          'Delete this field when acceptance[] carries the whole contract.',
        changes: buildTemplateChanges(complexitySignals),
        non_goals: [],
        reason_to_exist:
          'Fill: the single coherent reason this Story exists (one sentence).',
      },
      acceptance: [
        'Fill: a testable, observable criterion (a command exits 0, a file exists, a test matches)',
      ],
      verify: [
        'Fill: exact command or test path — keep the trailing tier tag valid: unit, contract, e2e, or validate (unit)',
      ],
      depends_on: [],
    },
  ];
  return `${JSON.stringify(template, null, 2)}\n`;
}

/**
 * Count top-level enumerated items (`- `, `* `, `1. `) anywhere in a
 * free-form seed text. Unlike {@link countScopeItems} this does not require
 * a scope-shaped heading — a raw `--seed` text rarely has one.
 *
 * @param {string} text
 * @returns {number}
 */
function countEnumeratedItems(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line)).length;
}

/**
 * Delta-shaped change-request verbs — the `core/scope-triage` skill's
 * change-request rubric routes these to `story` by default when the
 * footprint stays inside Story width.
 */
const DELTA_VERB_RE =
  /\b(fix(?:es)?|tweak(?:s)?|extend(?:s)?|update(?:s)?|adjust(?:s)?|rename(?:s)?|correct(?:s)?|patch(?:es)?|bug|regression|flaky)\b/i;

/**
 * Deterministic, CLI-applied scope-triage verdict over a raw `--seed` text
 * (#4496 fix 6). Embedding the verdict in the `--seed` envelope removes the
 * two skill Reads (`core/scope-triage` + the gate fragment's rubric pass)
 * from the headless path; the attended path keeps the skill-based judgment.
 *
 * The heuristics anchor to the same sizing SSOT the skill anchors to —
 * `DELIVERABLE_GRANULARITY_GUIDANCE` / `DEFAULT_MODEL_CAPACITY` in
 * `ticket-validator-sizing.js` (one Story = one coherent capability slice;
 * multiple independent capabilities = an Epic) — and to the skill's
 * change-request delta rubric. Like the skill, the verdict is **advisory**:
 * being wrong in the `epic` direction is cheap (the consolidation critic and
 * the sizing validator catch an over-planned Story later), and `borderline`
 * is a first-class output, not a forced call.
 *
 * @param {{ seedText?: string }} args
 * @returns {{ verdict: 'epic'|'story'|'borderline', reasons: string[], advisory: true, appliedBy: 'cli' }}
 */
export function buildScopeTriageSignal({ seedText = '' } = {}) {
  const advisory = /** @type {const} */ (true);
  const appliedBy = /** @type {const} */ ('cli');
  const text = typeof seedText === 'string' ? seedText : '';
  const listItems = countEnumeratedItems(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (listItems >= 3) {
    return {
      verdict: 'epic',
      reasons: [
        `seed enumerates ${listItems} candidate capabilities — a genuine fan-out surface`,
      ],
      advisory,
      appliedBy,
    };
  }
  if (listItems >= 1) {
    return {
      verdict: 'story',
      reasons: [
        `seed enumerates ${listItems} capability item(s) — one coherent change with one reason to exist`,
      ],
      advisory,
      appliedBy,
    };
  }
  if (DELTA_VERB_RE.test(text) && wordCount <= 120) {
    return {
      verdict: 'story',
      reasons: [
        'delta-shaped seed (change-request verb, no capability enumeration) within Story width',
      ],
      advisory,
      appliedBy,
    };
  }
  if (wordCount >= 250) {
    return {
      verdict: 'epic',
      reasons: [
        `broad prose seed (~${wordCount} words) with no enumeration — plausibly multiple independent capabilities`,
      ],
      advisory,
      appliedBy,
    };
  }
  return {
    verdict: 'borderline',
    reasons: [
      'no capability enumeration and no clear delta signal — could be one ambitious Story or a small Epic; the operator (or the --yes Recommended branch) decides',
    ],
    advisory,
    appliedBy,
  };
}

/**
 * Resolve the planning risk heuristics list from the canonical config
 * block (same resolution the decompose context uses).
 *
 * @param {object} config
 * @returns {string[]}
 */
function resolveRiskHeuristics(config = {}) {
  if (Array.isArray(config.planning?.riskHeuristics)) {
    return config.planning.riskHeuristics;
  }
  return [];
}

/**
 * Ceilings a seed's advisory complexity signals must fit for the plan
 * workflow to **suggest** the light path at Gate #1 (Story #4741 R3 plan-side
 * handshake). Framework constants, not operator knobs — mirroring the
 * conservative intent of `complexity-gate.js`'s `STORY_SHAPE_CEILINGS`
 * (small, mostly-additive, non-sensitive) but read against the *seed-time*
 * signals rather than an authored Story shape.
 *
 * The suggestion is **advisory only and never an automatic reroute**: it
 * surfaces at Gate #1 for the operator to decide, and under `--yes` it is
 * recorded on the envelope while planning proceeds unchanged.
 *
 * These ceilings are deliberately NOT the ones the light path itself applies
 * (Story #4760). A confirmed suggestion routes into
 * `workflows/helpers/deliver-light.md`, whose gate re-judges the *predicted
 * shape* against `STORY_SHAPE_CEILINGS`. Two checks at two different stages:
 * this one screens a seed, that one decides. Collapsing them would make a
 * confirm a bypass.
 *
 * **Risk only, never cardinality (Story #4856).** This carried a
 * `maxArtifacts: 2` ceiling — the second surviving artifact count after Story
 * #4764 retired the axis from the routing gate, and the more misleading of the
 * two, because the artifacts it counted were **paths scraped from seed prose**
 * rather than a measured footprint. Observed on the seed that produced Story
 * #4856: a change spanning four framework modules was suggested as light off
 * two scraped paths, one of which did not exist at the scraped location. A count
 * of guesses is not a size signal, so the screen now keys on risk alone.
 *
 *   - `maxRiskHeuristicHits`   — any risk-heuristic hit disqualifies: risk
 *                                is exactly what a light path should not carry.
 *   - `maxSensitivePathClasses`— any sensitive-path class disqualifies, the
 *                                same taxonomy close applies to a landed diff.
 */
const DELIVER_LIGHT_SUGGESTION_CEILINGS = Object.freeze({
  maxRiskHeuristicHits: 0,
  maxSensitivePathClasses: 0,
});

/**
 * Derive the advisory light-path suggestion from a seed's complexity signals
 * (Story #4741 AC-6). Pure and total: a malformed / missing signal bag fails
 * conservative (not suggested), never throws.
 *
 * `automatic: false` is part of the contract — the suggestion is surfaced for
 * the operator, never a silent reroute of a non-interactive run.
 *
 * @param {object|null|undefined} complexitySignals
 * @returns {{
 *   suggested: boolean,
 *   automatic: false,
 *   advisory: true,
 *   ceilings: typeof DELIVER_LIGHT_SUGGESTION_CEILINGS,
 *   reasons: string[],
 * }}
 */
export function buildDeliverLightSuggestion(complexitySignals) {
  const ceilings = DELIVER_LIGHT_SUGGESTION_CEILINGS;
  const advisory = /** @type {const} */ (true);
  const automatic = /** @type {const} */ (false);
  const s = complexitySignals ?? {};
  const riskHits = Array.isArray(s.riskHeuristicHits)
    ? s.riskHeuristicHits.length
    : Number.POSITIVE_INFINITY;
  const sensitive = Array.isArray(s.sensitivePathClasses)
    ? s.sensitivePathClasses.length
    : Number.POSITIVE_INFINITY;

  const reasons = [];
  if (riskHits > ceilings.maxRiskHeuristicHits) {
    reasons.push(`seed hits ${riskHits} risk-heuristic phrase(s)`);
  }
  if (sensitive > ceilings.maxSensitivePathClasses) {
    reasons.push(
      `predicted footprint touches ${sensitive} sensitive-path class(es)`,
    );
  }

  const suggested = reasons.length === 0;
  return {
    suggested,
    automatic,
    advisory,
    ceilings,
    reasons: suggested
      ? [
          'seed carries no risk signal (no risk-heuristic hits, no ' +
            'sensitive-path classes) — the operator may prefer /deliver for ' +
            "this scope; the light path's own gate and diff backstop decide size",
        ]
      : reasons,
  };
}

/**
 * The `audit-rules.json` lens `target` value marking a lens applicable only to
 * a project with a rendered frontend.
 */
const WEB_LENS_TARGET = 'web';

/**
 * How many matched UI paths the `uiSurface` signal carries. The signal rides the
 * `--out` stdout digest, which has a ~2KB contract, and a seed can predict up to
 * `MAX_PREDICTED_PATHS` paths — enumerating all of them would let one UI-heavy
 * seed blow that budget. The full count travels beside the sample as
 * `matchedPathCount`, so nothing is silently lost.
 */
const UI_MATCHED_PATH_SAMPLE = 5;

/**
 * Union of the `triggers.filePatterns` globs every `target: "web"` lens
 * registers in `audit-rules.json` — the framework's shipped declaration of
 * "this path is part of a rendered UI surface". Read from the manifest rather
 * than re-listed here: a second copy of the glob set would be a second thing to
 * keep in sync, and the manifest is already the place an operator extends it.
 *
 * @param {{ audits?: Record<string, object> }} rules
 * @returns {string[]} Deduplicated globs, in manifest order.
 */
function resolveWebFilePatterns(rules) {
  const patterns = new Set();
  for (const entry of Object.values(rules?.audits ?? {})) {
    if (entry?.target !== WEB_LENS_TARGET) continue;
    for (const glob of entry?.triggers?.filePatterns ?? []) {
      if (typeof glob === 'string' && glob !== '') patterns.add(glob);
    }
  }
  return [...patterns];
}

/**
 * Which predicted paths sit on a UI surface, per the web lens globs.
 *
 * An unreadable manifest is **indeterminate**, not "no match": the signal fails
 * OPEN in the same direction {@link hasWebSurface} does, because a spurious
 * mention of an operator-invoked command costs nothing while a missed one costs
 * the whole point of the offer.
 *
 * @param {string[]} predictedPaths
 * @returns {{ matchedPaths: string[], indeterminate: boolean }}
 */
function resolveWebFootprintMatch(predictedPaths) {
  let patterns;
  try {
    patterns = resolveWebFilePatterns(readAuditRulesSync());
  } catch {
    return { matchedPaths: [], indeterminate: true };
  }
  return {
    matchedPaths: predictedPaths.filter((p) =>
      matchesAnyFilePattern(patterns, [p]),
    ),
    indeterminate: false,
  };
}

/**
 * The one sentence a `uiSurface` signal carries — why the offer fires, or why it
 * does not. Kept in one place so the fired and unfired shapes stay one object.
 *
 * @param {{
 *   detected: boolean,
 *   webSurface: boolean,
 *   indeterminate: boolean,
 *   sample: string[],
 *   count: number,
 * }} facts
 * @returns {string}
 */
function uiSurfaceReason({
  detected,
  webSurface,
  indeterminate,
  sample,
  count,
}) {
  if (!detected) {
    return webSurface
      ? 'no predicted path matches a web lens filePattern — nothing to prototype'
      : 'project has no rendered web surface — nothing to prototype';
  }
  if (indeterminate) {
    return 'web-capable project and the UI-path manifest could not be read — offering /prototype rather than dropping the option';
  }
  const elided = count - sample.length;
  const shown =
    elided > 0 ? `${sample.join(', ')}, +${elided} more` : sample.join(', ');
  return `web-capable project and the predicted footprint touches ${count} UI path(s) (${shown}) — the operator may want /prototype before UI acceptance criteria are authored`;
}

/**
 * Derive the advisory **UI-surface** signal from a seed's predicted footprint.
 *
 * Two observables, both already shipped, ANDed together:
 *
 *   1. the project is web-capable at all (`hasWebSurface` — the same
 *      applicability predicate the `target: "web"` audit lenses gate on), and
 *   2. at least one predicted path matches a web lens `filePattern`.
 *
 * No new detection surface and no new `.agentrc.json` key: both halves are
 * derived from the consumer's own checkout, so a frontend-less project — this
 * repository included — resolves falsey and the offer never fires.
 *
 * The signal carries **no routing authority** (`automatic: false`): `/plan`
 * may say that a plan touches UI and that `/prototype` exists, and must never
 * invoke it. Pure over its inputs and total — a malformed signal bag or an
 * unreadable manifest degrades, never throws.
 *
 * @param {{
 *   complexitySignals?: object|null,
 *   config?: object,
 *   cwd?: string,
 * }} [args]
 * @returns {{
 *   detected: boolean,
 *   automatic: false,
 *   advisory: true,
 *   webSurface: boolean,
 *   matchedPaths: string[],
 *   matchedPathCount: number,
 *   reasons: string[],
 * }} `matchedPaths` is a bounded sample
 *   ({@link UI_MATCHED_PATH_SAMPLE}); `matchedPathCount` is the full total.
 */
function buildUiSurfaceSignal({ complexitySignals, config, cwd } = {}) {
  const predictedPaths = Array.isArray(complexitySignals?.predictedPaths)
    ? complexitySignals.predictedPaths.filter((p) => typeof p === 'string')
    : [];
  const projectRoot =
    typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();

  let webSurface;
  try {
    webSurface = hasWebSurface({ config, projectRoot });
  } catch {
    webSurface = true; // indeterminate ⇒ fail open
  }

  const { matchedPaths, indeterminate } =
    resolveWebFootprintMatch(predictedPaths);
  const detected = webSurface && (indeterminate || matchedPaths.length > 0);
  const sample = matchedPaths.slice(0, UI_MATCHED_PATH_SAMPLE);

  return {
    detected,
    automatic: /** @type {const} */ (false),
    advisory: /** @type {const} */ (true),
    webSurface,
    matchedPaths: sample,
    matchedPathCount: matchedPaths.length,
    reasons: [
      uiSurfaceReason({
        detected,
        webSurface,
        indeterminate,
        sample,
        count: matchedPaths.length,
      }),
    ],
  };
}

/**
 * Attach the advisory routing/offer signals to a complexity-signals bag as
 * **nested** fields (Story #4741). Nesting — rather than new top-level envelope
 * keys — keeps every existing per-mode envelope key set byte-stable: both are
 * derived from the signals they ride on.
 *
 * @param {object} complexitySignals
 * @param {{ config?: object, cwd?: string }} [context]
 * @returns {object} the same signals plus `deliverLightSuggestion` and
 *   `uiSurface`.
 */
function withAdvisorySignals(complexitySignals, { config, cwd } = {}) {
  return {
    ...complexitySignals,
    deliverLightSuggestion: buildDeliverLightSuggestion(complexitySignals),
    uiSurface: buildUiSurfaceSignal({ complexitySignals, config, cwd }),
  };
}

/**
 * Count top-level enumerated items (`- `, `* `, `1. `) under the first
 * scope-shaped `## ` heading (Scope / MVP Scope / Proposed Scope / Work
 * Breakdown / Capabilities), up to the next `## ` heading. Returns `null`
 * when no scope-shaped heading exists — the caller treats that as "no
 * sizing signal" and defaults to fan-out.
 *
 * @param {string} body
 * @returns {number|null}
 */
function countScopeItems(body) {
  if (typeof body !== 'string' || body.length === 0) return null;
  const lines = body.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) =>
    /^##\s+(?:(?:MVP\s+|Proposed\s+)?Scope(?:\s+\([^)]+\))?|Work\s+Breakdown|Capabilities)\s*$/i.test(
      line.trim(),
    ),
  );
  if (headingIdx === -1) return null;
  let count = 0;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    if (/^\s*(?:[-*]|\d+\.)\s+\S/.test(line)) count += 1;
  }
  return count;
}

/**
 * Advisory single-vs-fan-out delivery-shape signal (design § 1 step 1;
 * routing pilot #4475). Derived from the same size/shape heuristics the
 * scope-triage rubric anchors to — the Delivery Slicing table when the Epic
 * body already carries one (slice count + "Independent?" chain shape,
 * via the Phase 8.3 precondition parser), else a scope-enumeration count.
 *
 * **Advisory only, fan-out by default.** This signal changes no routing
 * behaviour in this PR: the deliver-side reader is #4475's scope, and until
 * it lands the recommendation defaults to `fan-out` for every ambiguous
 * case. `single` is recommended only on clear one-pass indicators: a
 * slicing table proposing ≤ 2 slices, a pure dependent chain (zero
 * realized parallelism from the Story tier — the N=2 bench finding), or a
 * scope enumeration of ≤ 2 capabilities.
 *
 * @param {{ body: string }} args
 * @returns {{ recommendation: 'single'|'fan-out', reasons: string[], advisory: true }}
 */
export function buildDeliveryShapeSignal({ body } = {}) {
  const advisory = /** @type {const} */ (true);
  const rows = parseDeliverySlicingTable(body ?? '');

  if (Array.isArray(rows) && rows.length > 0) {
    if (rows.length <= 2) {
      return {
        recommendation: 'single',
        reasons: [
          `delivery-slicing table proposes ${rows.length} slice(s) — one-pass-sized`,
        ],
        advisory,
      };
    }
    const chain = rows.slice(1).every((r) => r.independent === false);
    if (chain) {
      return {
        recommendation: 'single',
        reasons: [
          `delivery-slicing table is a pure dependent chain (${rows.length} slices, every non-first slice "Independent? No") — zero parallelism value from Story fan-out`,
        ],
        advisory,
      };
    }
    return {
      recommendation: 'fan-out',
      reasons: [
        `delivery-slicing table proposes ${rows.length} slices with independent parallelism`,
      ],
      advisory,
    };
  }

  const scopeItems = countScopeItems(body ?? '');
  if (scopeItems !== null && scopeItems > 0 && scopeItems <= 2) {
    return {
      recommendation: 'single',
      reasons: [
        `scope enumerates ${scopeItems} capability item(s) — one-pass-sized`,
      ],
      advisory,
    };
  }
  if (scopeItems !== null && scopeItems > 2) {
    return {
      recommendation: 'fan-out',
      reasons: [`scope enumerates ${scopeItems} capability items`],
      advisory,
    };
  }
  return {
    recommendation: 'fan-out',
    reasons: [
      'no delivery-slicing table or scope enumeration to size against — defaulting to fan-out',
    ],
    advisory,
  };
}

/**
 * Render the three authoring system prompts the collapsed pipeline's
 * single authoring pass consumes. The spec/acceptance prompts render from
 * `lib/templates/spec-author-prompts.js` (the M3/M8 handshake — envelope
 * authoritative from day one); the decompose prompt reuses the existing
 * Story #4162 carrier including the risk-heuristics suffix.
 *
 * @param {{ heuristics?: string[], maxTickets?: number }} args
 * @returns {{ spec: string, acceptance: string, decompose: string }}
 */
export function buildSystemPrompts({ heuristics = [], maxTickets } = {}) {
  const decompose = buildDecomposerSystemPrompt(heuristics, {
    maxTickets,
  });
  return {
    spec: renderTechSpecSystemPrompt(),
    acceptance: renderAcceptanceSpecSystemPrompt(),
    // v2 Stage 3: default-single author prompt (decompose text + split policy).
    story: `${decompose}

#### v2 DEFAULT-SINGLE SPLIT POLICY:

Emit **exactly one Story** in \`stories.json\` unless the pieces have
near-zero overlap or sit across an architectural seam. Coupled work stays
one Story — put intra-session checkpoints in \`## Slicing\` and fold the
Tech Spec into \`## Spec\` (inline only; over-budget Specs mean split or
tighten — never write under \`docs/\`). Do **not** emit \`deliveryShape\`.
When N>1, every acceptance criterion must belong to exactly one Story,
and each Story carries its own \`## Spec\` (no shared techspec.md fold).
`,
    decompose,
  };
}

/**
 * Run the open-Story duplicate search. Failures degrade to [] — triage
 * signal, not a gate.
 *
 * @param {{
 *   seed: string,
 *   provider: object,
 *   config: object,
 *   excludeIds?: Iterable<number|string>,
 * }} args
 * @returns {Promise<Array<object>>}
 */
async function searchStoryDuplicates({
  seed,
  provider,
  config,
  excludeIds = [],
}) {
  try {
    return await findSimilarOpenStories({
      seed,
      provider,
      owner: config.github?.owner,
      repo: config.github?.repo,
      excludeIds,
    });
  } catch (err) {
    Logger.warn(
      `[plan-context] duplicate search degraded to no candidates: ${err?.message ?? err}`,
    );
    return [];
  }
}

/**
 * Gather the three independent envelope inputs — the open-Story duplicate
 * search, the folded authoring context, and the inline docs digest — under
 * bounded concurrency (Story #4952).
 *
 * None of the three reads a value the others produce, so the result is a pure
 * function of `seed` and the injected config: the assembled envelope is
 * **byte-identical** to the serial build for the same inputs, whichever order
 * the three happen to settle in. `concurrentMap` preserves input order, so the
 * destructuring below is positional and stable.
 *
 * `docsContextFiles` is emptied for the `buildAuthoringContext` call: the
 * per-plan digest-file path needs a plan id that does not exist yet — the
 * inline digest gathered alongside it replaces that pointer.
 *
 * @param {{
 *   seed: string,
 *   epicTitle: string,
 *   excludeIds?: Iterable<number|string>,
 *   provider: object,
 *   config: object,
 *   settings: object,
 *   cwd?: string,
 * }} args
 * @returns {Promise<{
 *   duplicates: Array<object>,
 *   authoring: object,
 *   docsContext: { mode: 'digest-inline', digest: string }|null,
 * }>}
 */
async function gatherEnvelopeInputs({
  seed,
  epicTitle,
  excludeIds = [],
  provider,
  config,
  settings,
  cwd,
}) {
  const paths = settings?.paths ?? {};
  const [duplicates, authoring, inlineDigest] = await concurrentMap(
    [
      () => searchStoryDuplicates({ seed, provider, config, excludeIds }),
      () =>
        buildAuthoringContext(
          0,
          /* provider (unused behind the prefetch seam) */ {},
          { ...settings, docsContextFiles: [] },
          {
            epic: { id: 0, title: epicTitle, body: seed },
            github: config.github ?? null,
            cwd,
          },
        ),
      () =>
        buildDocsDigest({
          docsContextFiles: settings?.docsContextFiles,
          docsRoot: paths.docsRoot,
        }),
    ],
    (gather) => gather(),
    // The per-mode envelope gathers (Story #4952): the duplicate search, the
    // authoring-context fold and the docs digest have no data dependency on
    // one another, so their serialization was incidental and `/plan` paid it
    // with the operator waiting at Gate #1.
    { concurrency: FANOUT_CONCURRENCY },
  );

  return {
    duplicates,
    authoring,
    docsContext:
      inlineDigest == null
        ? null
        : { mode: 'digest-inline', digest: inlineDigest },
  };
}

/**
 * Build the seed-file (ideation) envelope. No parent ticket
 * exists yet — creation moves to the persist half — so the open-Story
 * dup search is the mode's gating input. `docsContext` is inline-digest:
 * there is no plan temp directory to anchor a digest file to yet.
 */
async function buildSeedFileModeEnvelope({
  seedFilePath,
  seedFileContent,
  provider,
  config,
  settings,
  cwd,
  modeLabel = 'seed-file',
}) {
  const content =
    seedFileContent ?? (await readFile(seedFilePath ?? '', 'utf-8'));
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error(
      `[plan-context] seed-file at ${seedFilePath ?? '(inline)'} is empty — nothing to plan from.`,
    );
  }

  // Dup search, the authoring-context fold grounded in the seed prose, and the
  // inline docs digest are independent — gathered concurrently (Story #4952).
  const { duplicates, authoring, docsContext } = await gatherEnvelopeInputs({
    seed: content,
    epicTitle: seedFilePath ?? 'seed',
    provider,
    config,
    settings,
    cwd,
  });

  const limits = getLimits(config);
  const heuristics = resolveRiskHeuristics(config);

  return {
    mode: modeLabel,
    seed: { path: seedFilePath ?? null, content },
    // Advisory complexity signals only (Story #4722): no route, no routing
    // authority. The planner authors the trivial-vs-standard verdict; persist
    // validates a lite claim against the authored Story's shape. The nested
    // `deliverLightSuggestion` is the advisory plan-side routing handshake
    // (Story #4741 AC-6) and `uiSurface` the advisory /prototype offer —
    // neither is ever an automatic reroute.
    complexitySignals: withAdvisorySignals(
      buildComplexitySignals({
        seedText: content,
        config,
        riskHeuristics: heuristics,
        cwd,
      }),
      { config, cwd },
    ),
    duplicates,
    docsContext,
    bddRunner: authoring.bddRunner,
    bddScenarios: authoring.bddScenarios,
    memoryPoolAdvisory: authoring.memoryPoolAdvisory,
    priorFeedback: authoring.priorFeedback,
    ticketSchema: TICKET_SCHEMA_DESCRIPTOR,
    maxTickets: limits.maxTickets,
    riskHeuristics: heuristics,
    systemPrompts: buildSystemPrompts({
      heuristics,
      maxTickets: limits.maxTickets,
    }),
    planState: null,
    // N=1 default: author one Story; skip Epic-scale decompose ceremony.
    planProfile: 'story-default',
  };
}

/**
 * Build the seed-mode (chat text) envelope. The seed-file does not exist
 * yet: the dup search and the authoring-context fold both run off the raw
 * seed text (N=1 default — no Epic-scale decompose).
 */
async function buildSeedModeEnvelope({
  seedText,
  provider,
  config,
  settings,
  cwd,
}) {
  if (typeof seedText !== 'string' || seedText.trim().length === 0) {
    throw new Error(
      '[plan-context] --seed requires non-empty seed text — nothing to plan from.',
    );
  }
  const base = await buildSeedFileModeEnvelope({
    seedFilePath: undefined,
    seedFileContent: seedText,
    provider,
    config,
    settings,
    cwd,
    modeLabel: 'seed',
  });
  const { seed: _seed, ...rest } = base;
  return {
    ...rest,
    mode: 'seed',
    seed: { text: seedText, path: null },
  };
}

/**
 * Fetch source tickets for `--tickets` mode.
 * Hydrates ids concurrently (bounded) while preserving input order.
 *
 * @param {number[]} ticketIds
 * @param {object} provider
 * @returns {Promise<Array<{ id:number, title:string, body:string, labels:string[], url?:string }>>}
 */
async function fetchSourceTickets(ticketIds, provider) {
  if (!provider || typeof provider.getTicket !== 'function') {
    throw new Error(
      '[plan-context] tickets mode requires provider.getTicket()',
    );
  }
  return concurrentMap(
    ticketIds,
    async (id) => {
      const ticket = await provider.getTicket(id);
      if (!ticket) {
        throw new Error(`[plan-context] ticket #${id} not found`);
      }
      return {
        id: Number(ticket.id ?? ticket.number ?? id),
        title: ticket.title ?? '',
        body: ticket.body ?? '',
        labels: Array.isArray(ticket.labels)
          ? ticket.labels
              .map((l) => (typeof l === 'string' ? l : l?.name))
              .filter(Boolean)
          : [],
        url: ticket.html_url ?? ticket.url ?? undefined,
        state: ticket.state ?? undefined,
      };
    },
    // `--tickets` source-ticket hydration: one independent read per id.
    { concurrency: FANOUT_CONCURRENCY },
  );
}

/**
 * Build the tickets-mode envelope — analyze existing issue(s) into proper
 * Stories. Dup search excludes the source ids so a ticket is not reported
 * as a duplicate of itself.
 */
async function buildTicketsModeEnvelope({
  ticketIds,
  provider,
  config,
  settings,
  cwd,
}) {
  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    throw new Error(
      '[plan-context] --tickets requires one or more positive issue ids.',
    );
  }
  const sourceTickets = await fetchSourceTickets(ticketIds, provider);
  const seed = sourceTickets
    .map((t) => `# ${t.title}\n\n${t.body}`)
    .join('\n\n---\n\n');

  // Same three independent gathers as seed-file mode, concurrent under the
  // same bound (Story #4952); only the source-ticket hydration above is a
  // genuine data dependency, because `seed` is derived from it.
  const { duplicates, authoring, docsContext } = await gatherEnvelopeInputs({
    seed,
    epicTitle: sourceTickets[0]?.title ?? 'tickets',
    excludeIds: ticketIds,
    provider,
    config,
    settings,
    cwd,
  });

  const limits = getLimits(config);
  const heuristics = resolveRiskHeuristics(config);

  return {
    mode: 'tickets',
    sourceTickets,
    seed: { text: seed, path: null },
    complexitySignals: withAdvisorySignals(
      buildComplexitySignals({
        seedText: seed,
        config,
        riskHeuristics: heuristics,
        cwd,
      }),
      { config, cwd },
    ),
    duplicates,
    docsContext,
    bddRunner: authoring.bddRunner,
    bddScenarios: authoring.bddScenarios,
    memoryPoolAdvisory: authoring.memoryPoolAdvisory,
    priorFeedback: authoring.priorFeedback,
    ticketSchema: TICKET_SCHEMA_DESCRIPTOR,
    maxTickets: limits.maxTickets,
    riskHeuristics: heuristics,
    systemPrompts: buildSystemPrompts({
      heuristics,
      maxTickets: limits.maxTickets,
    }),
    planState: null,
    planProfile:
      ticketIds.length === 1 ? 'story-default' : 'story-from-tickets',
    instruction:
      'Analyze the source ticket(s) and author proper type::story ' +
      'ticket(s) under the default-single split policy. Prefer rewriting ' +
      'the source into one well-formed Story (N=1) unless the split policy ' +
      'applies. Do not open an Epic.',
  };
}

/**
 * Parse a prior Story body into its acceptance criteria and delivered file
 * map. Total: an unparseable body degrades to empty lists (a delta envelope
 * grounded on whatever survived), never a throw.
 *
 * @param {string} priorBody
 * @returns {{ priorAcceptance: string[], deliveredFiles: string[] }}
 */
function extractPriorArtifacts(priorBody) {
  let parsed;
  try {
    parsed = parseStoryBody(priorBody).body;
  } catch {
    return { priorAcceptance: [], deliveredFiles: [] };
  }
  const priorAcceptance = Array.isArray(parsed.acceptance)
    ? parsed.acceptance.filter((a) => typeof a === 'string' && a.length > 0)
    : [];
  const deliveredFiles = Array.isArray(parsed.changes)
    ? parsed.changes
        .map((c) => (c && typeof c === 'object' ? c.path : c))
        .filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  return { priorAcceptance, deliveredFiles };
}

/**
 * Build the amendment (delta) envelope — `plan-context --amends #<id>`
 * (Story #4741 AC-4, R3-A). The heavy-amendment counterpart to routing a
 * light amendment through the light path: instead of re-interrogating the
 * repo from scratch (`buildAuthoringContext`'s codebase snapshot and the BDD /
 * memory / feedback probes), the envelope composes a DELTA from what already
 * exists — the prior Story's body, its acceptance criteria (the real
 * contract), and its delivered file map — so a follow-up change plans from the
 * shape already shipped.
 *
 * The semantic steps that reach the ticket are preserved: the open-Story
 * duplicate search (excluding the amended Story itself), the risk heuristics,
 * and the authoring system prompts all still ride the envelope. What is
 * dropped is only the from-scratch repo interrogation the prior artifacts
 * already stand in for — that is the round-trip diet, not an amputation.
 *
 * @param {{
 *   amendsId: number,
 *   provider: object,
 *   config: object,
 *   settings: object,
 *   cwd?: string,
 * }} args
 * @returns {Promise<object>}
 */
async function buildAmendmentModeEnvelope({
  amendsId,
  provider,
  config,
  settings: _settings,
  cwd,
}) {
  if (!provider || typeof provider.getTicket !== 'function') {
    throw new Error(
      '[plan-context] --amends requires provider.getTicket() to load the prior Story.',
    );
  }
  const prior = await provider.getTicket(amendsId);
  if (!prior) {
    throw new Error(
      `[plan-context] --amends #${amendsId}: prior Story not found — nothing to amend.`,
    );
  }
  const priorBody = typeof prior.body === 'string' ? prior.body : '';
  const { priorAcceptance, deliveredFiles } = extractPriorArtifacts(priorBody);

  const heuristics = resolveRiskHeuristics(config);
  const limits = getLimits(config);
  // Story #4952 — this builder's independent-gather set has exactly one
  // member. `provider.getTicket` above is a hard data dependency (the prior
  // body IS the seed), and the mode deliberately carries no authoring-context
  // fold and no docs digest — the prior artifacts are the grounding. It still
  // goes through the same bounded gather as the other two builders so one file
  // does not carry two ways of gathering independent envelope inputs.
  const [duplicates] = await concurrentMap(
    [
      () =>
        searchStoryDuplicates({
          seed: priorBody,
          provider,
          config,
          excludeIds: [amendsId],
        }),
    ],
    (gather) => gather(),
    // Same independent-gather fan-out as the seed-mode envelope above.
    { concurrency: FANOUT_CONCURRENCY },
  );

  return {
    mode: 'amends',
    amends: {
      id: Number(prior.id ?? prior.number ?? amendsId),
      title: prior.title ?? '',
      priorBody,
      priorAcceptance,
      deliveredFiles,
    },
    // The prior body is the seed the delta is authored against.
    seed: { text: priorBody, path: null },
    complexitySignals: withAdvisorySignals(
      buildComplexitySignals({
        seedText: priorBody,
        config,
        riskHeuristics: heuristics,
        cwd,
      }),
      { config, cwd },
    ),
    duplicates,
    // No plan temp dir and no from-scratch repo interrogation — the prior
    // artifacts are the grounding, so there is no docs digest to anchor.
    docsContext: null,
    ticketSchema: TICKET_SCHEMA_DESCRIPTOR,
    maxTickets: limits.maxTickets,
    riskHeuristics: heuristics,
    systemPrompts: buildSystemPrompts({
      heuristics,
      maxTickets: limits.maxTickets,
    }),
    planState: null,
    planProfile: 'story-amendment',
  };
}

/**
 * Build the single planner-context envelope.
 *
 * Every mode returns through here, which makes this the one place the
 * envelope's total size is decided — and therefore the only honest place to
 * bound it (see {@link assertPlanContextWithinCeiling}).
 *
 * @param {{
 *   mode: 'seed-file'|'seed'|'tickets'|'amends',
 *   seedFilePath?: string,
 *   seedFileContent?: string,
 *   seedText?: string,
 *   ticketIds?: number[],
 *   amendsId?: number,
 *   provider: object,
 *   config: object,
 *   settings: object,
 *   cwd?: string,
 * }} args
 * @returns {Promise<object>} the JSON-serialisable envelope.
 */
export async function buildPlanContext({
  mode,
  seedFilePath,
  seedFileContent,
  seedText,
  ticketIds,
  amendsId,
  provider,
  config = {},
  settings = {},
  cwd,
}) {
  return assertPlanContextWithinCeiling(
    await buildPlanContextEnvelope({
      mode,
      seedFilePath,
      seedFileContent,
      seedText,
      ticketIds,
      amendsId,
      provider,
      config,
      settings,
      cwd,
    }),
  );
}

/**
 * Mode dispatch for {@link buildPlanContext}. Split out so the ceiling check
 * wraps every mode exactly once.
 */
async function buildPlanContextEnvelope({
  mode,
  seedFilePath,
  seedFileContent,
  seedText,
  ticketIds,
  amendsId,
  provider,
  config,
  settings,
  cwd,
}) {
  if (mode === 'amends') {
    return buildAmendmentModeEnvelope({
      amendsId,
      provider,
      config,
      settings,
      cwd,
    });
  }
  if (mode === 'seed-file') {
    if (!seedFilePath && typeof seedFileContent !== 'string') {
      throw new Error(
        '[plan-context] seed-file mode requires --seed-file <path>.',
      );
    }
    return buildSeedFileModeEnvelope({
      seedFilePath,
      seedFileContent,
      provider,
      config,
      settings,
      cwd,
      modeLabel: 'seed-file',
    });
  }
  if (mode === 'seed') {
    return buildSeedModeEnvelope({
      seedText,
      provider,
      config,
      settings,
      cwd,
    });
  }
  if (mode === 'tickets') {
    return buildTicketsModeEnvelope({
      ticketIds,
      provider,
      config,
      settings,
      cwd,
    });
  }
  throw new Error(
    `[plan-context] unknown mode "${mode}" — expected "seed", "seed-file", "tickets", or "amends".`,
  );
}
