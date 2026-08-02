/**
 * lib/wave-runner/ready-set.js — the path-agnostic ready-set scheduling
 * core.
 *
 * This module is the scheduling kernel the v2 `/deliver` multi-Story path
 * dispatches through (`stories-wave-tick.js`). It replaces wave-*batch* selection
 * (group N must fully drain before group N+1 opens) with *continuous*,
 * dependency-driven selection: a Story becomes dispatchable the instant
 * **its own** dependencies are satisfied, regardless of whether unrelated
 * Stories in some nominal wave are still running. There is no false
 * barrier — a Story C that depends only on a done Story A is selected even
 * while an unrelated Story B is still pending.
 *
 * It is deliberately **path-agnostic and side-effect-free**: it neither
 * reads GitHub, the lifecycle ledger, nor a checkpoint, and it dispatches
 * nothing. Callers supply the live Story records (already fetched), the
 * resolved `inFlight` count, and the `globalCap`, and receive back the set
 * of Stories that are safe to dispatch on this beat. The
 * `stories-wave-tick.js` adapter wires this core; this module does not
 * modify that CLI surface.
 *
 * The scheduling surface:
 *   - `classifyStory(story)` — live-label classifier mapping a Story
 *     record's labels + issue state to one of `done | blocked | executing |
 *     ready`. Mirrors the done-predicate this module uses
 *     (`agent::done` OR closed issue) so a Story closed manually through
 *     the GitHub UI is recognised as done.
 *   - `storiesOverlap(a, b)` — the **beat-local** file-overlap co-dispatch
 *     guard: true when two Stories' file footprints intersect. Two Stories
 *     that would touch the same file MUST NOT be admitted onto parallel
 *     `story-<id>` branches on the same beat (they would race the same path
 *     and produce a merge conflict at close). The comparison runs over
 *     the **widened** footprint (`storyWidenedFootprint`) — a declared
 *     `changes[]` is treated as a lower bound and widened from the paths the
 *     Story's own text names, because a guard that trusts a prediction cannot
 *     prevent the collision nobody predicted (Story #4875).
 *   - `planReadySet({ stories, doneIds, inFlight, globalCap,
 *     inFlightRecords })` — the scheduler. Returns the deterministic,
 *     overlap-free dispatch set (capped at `globalCap − inFlight`) **and**
 *     the Stories it withheld because a **concrete** path in their footprint
 *     is reserved by a Story still in flight from an earlier beat.
 *
 * The two guards deliberately draw the glob/UNKNOWN class differently
 * (Story #4960). Within a beat an unknown-width footprint overlaps
 * everything, because admitting two Stories whose real widths are unknown is
 * the collision the guard exists to prevent. Across beats it reserves
 * nothing: an in-flight Story's window spans its whole implementation, so a
 * glob that reserved cross-beat would withhold every other Story for
 * minutes-to-hours — and `resolve-stories.js` substitutes the UNKNOWN
 * sentinel for any body it cannot parse, so a single malformed Story body
 * would collapse an N-Story run to fully serial.
 *
 * Adjacency is re-derived from the supplied records via the shared
 * `buildStoryAdjacency` builder (`lib/story-adjacency.js`) — the same
 * `blocked by #NNN` / `dependencies[]` source order the dispatch manifest
 * and the existing wave wrappers use — so this core never disagrees with
 * the manifest about what depends on what.
 *
 * @module lib/wave-runner/ready-set
 */

import { AGENT_LABELS } from '../label-constants.js';
import { buildStoryAdjacency } from '../story-adjacency.js';

/**
 * @typedef {object} StoryRecord
 * @property {number|string} [id]      Story id (preferred).
 * @property {number} [number]         Story id (GitHub issue-number shape).
 * @property {string} [title]
 * @property {string} [body]           Used by `buildStoryAdjacency` to parse
 *   `blocked by #NNN` / `depends on #NNN` references.
 * @property {string[]} [labels]       Live `agent::*` labels.
 * @property {string} [state]          GitHub issue state (`open` | `closed`).
 * @property {Array<number|string>} [dependencies] Explicit dependency ids.
 * @property {Array<number|string>} [dependsOn]     Operator-DAG dependency ids.
 * @property {string[]} [files]        Declared file footprint (one of the
 *   accepted footprint shapes — see `storyFootprint`).
 * @property {string[]} [changes]      Alternate footprint shape.
 * @property {Array<{path?: string}>} [changeset] Alternate footprint shape.
 */

/** @typedef {'done'|'blocked'|'executing'|'ready'} StoryClass */

/**
 * Normalize a Story record's id to a positive integer, or `null` when it is
 * absent / non-integer. Accepts both the ticket shape (`id`) and the raw
 * GitHub issue shape (`number`), matching `buildStoryAdjacency`.
 *
 * @param {StoryRecord|number|string} story
 * @returns {number|null}
 */
export function storyIdOf(story) {
  if (typeof story === 'number') {
    return Number.isInteger(story) && story > 0 ? story : null;
  }
  const raw = story?.id ?? story?.number;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Classify a Story from its **live** labels and issue state.
 *
 * Precedence (highest first):
 *   1. `done`      — carries `agent::done` OR the issue is `state === 'closed'`.
 *                    The closed-state arm aligns with `tick.js#isStoryDone`
 *                    so a Story closed manually in the GitHub UI (issue
 *                    closed, label not flipped) still reads as done and is
 *                    never re-dispatched.
 *   2. `blocked`   — carries `agent::blocked`.
 *   3. `executing` — carries `agent::executing` OR `agent::closing` (both
 *                    are in-flight: an executing or closing Story occupies a
 *                    slot and must not be re-dispatched).
 *   4. `ready`     — none of the above; the Story is eligible for dispatch
 *                    once its dependencies are satisfied.
 *
 * `done` wins over every in-progress label so a stale `agent::executing`
 * left behind on an issue that has since closed never masks completion.
 *
 * @param {StoryRecord} story
 * @returns {StoryClass}
 */
export function classifyStory(story) {
  const labels = Array.isArray(story?.labels) ? story.labels : [];
  if (labels.includes(AGENT_LABELS.DONE) || story?.state === 'closed') {
    return 'done';
  }
  if (labels.includes(AGENT_LABELS.BLOCKED)) return 'blocked';
  if (
    labels.includes(AGENT_LABELS.EXECUTING) ||
    labels.includes(AGENT_LABELS.CLOSING)
  ) {
    return 'executing';
  }
  return 'ready';
}

/**
 * Extract a Story's declared file footprint as a normalized set of path
 * strings. Accepts the three footprint shapes a Story record can carry:
 *
 *   - `files: string[]`                         — explicit footprint.
 *   - `changes: string[]`                       — string-array sketch.
 *   - `changeset: Array<{ path }>` /            — object-array sketch (the
 *     `changes: Array<{ path }>`                   `{ path, assumption }`
 *                                                  shape from a Story body).
 *
 * Paths are trimmed; empty / non-string entries are dropped. A Story with
 * no declared footprint yields an empty set, which (by `storiesOverlap`'s
 * contract) means it overlaps with nothing and is never withheld by the
 * co-dispatch guard.
 *
 * @param {StoryRecord} story
 * @returns {Set<string>}
 */
export function storyFootprint(story) {
  const out = new Set();
  const push = (entry) => {
    const path =
      typeof entry === 'string'
        ? entry
        : typeof entry?.path === 'string'
          ? entry.path
          : null;
    if (!path) return;
    const trimmed = path.trim();
    if (trimmed) out.add(trimmed);
  };
  if (Array.isArray(story?.files)) for (const e of story.files) push(e);
  if (Array.isArray(story?.changes)) for (const e of story.changes) push(e);
  if (Array.isArray(story?.changeset)) for (const e of story.changeset) push(e);
  return out;
}

/**
 * Does a declared path contain a glob metacharacter? Mirrors the detection
 * in `story-body.js#extractChangePaths`, whose `isGlob` flag documents an
 * "unknown-width footprint" policy that was never implemented downstream.
 *
 * @param {string} path
 * @returns {boolean}
 */
function isGlobPath(path) {
  return path.includes('*') || path.includes('?') || path.includes('{');
}

/**
 * Repo-relative file paths as they appear in Story prose: at least one `/`
 * separator and a short file extension. Deliberately narrow — a token has to
 * look like a real path before it can widen a footprint and withhold a Story.
 */
const PROSE_PATH_RE = /(?:[\w.@~-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,6}/g;

/**
 * Scrape file paths a Story's **text** mentions but its `changes[]` never
 * declared (Story #4875).
 *
 * The declared footprint is a planner's *prediction*, and it is systematically
 * a lower bound: a Story's `## Spec` names the module it must also touch, its
 * acceptance criteria name the caller that must be updated, and none of that
 * reaches `changes[]`. The overlap guard exists to stop two Stories racing the
 * same file, so trusting the declaration outright means the guard is blind to
 * precisely the collisions nobody predicted.
 *
 * Evidence is only ever **added** — nothing here can shrink a declared
 * footprint, so widening can withhold a Story for a beat but can never
 * co-dispatch one the declared comparison would have caught.
 *
 * @param {StoryRecord} story
 * @returns {Set<string>}
 */
function storyEvidencePaths(story) {
  const out = new Set();
  for (const field of [story?.title, story?.body, story?.spec]) {
    if (typeof field !== 'string' || field === '') continue;
    for (const match of field.matchAll(PROSE_PATH_RE)) {
      const trimmed = match[0].trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return out;
}

/**
 * A Story's footprint **widened from observable evidence** — the set the
 * co-dispatch guard actually compares (Story #4875).
 *
 * `declared ∪ scraped-from-prose`. See {@link storyEvidencePaths} for why the
 * declaration is treated as a lower bound rather than the answer.
 *
 * @param {StoryRecord} story
 * @returns {Set<string>}
 */
function storyWidenedFootprint(story) {
  const out = storyFootprint(story);
  for (const path of storyEvidencePaths(story)) out.add(path);
  return out;
}

/**
 * Both Stories' widened footprints, or `null` when either is empty.
 *
 * **An empty footprint means "no known overlap"**, so both guards below
 * short-circuit to `false` on one. This is permissive by necessity: a Story
 * with no declared footprint and no path evidence in its text carries no
 * information, and withholding on absence would serialize every run.
 *
 * @param {StoryRecord} a
 * @param {StoryRecord} b
 * @returns {[Set<string>, Set<string>]|null}
 */
function widenedFootprintPair(a, b) {
  const fa = storyWidenedFootprint(a);
  if (fa.size === 0) return null;
  const fb = storyWidenedFootprint(b);
  if (fb.size === 0) return null;
  return [fa, fb];
}

/**
 * **Beat-local** file-overlap co-dispatch guard. Returns `true` when two
 * Stories' file footprints intersect — meaning they would race the same file
 * if both were admitted onto parallel `story-<id>` branches on this beat.
 *
 * Comparison runs over the **widened** footprint
 * ({@link storyWidenedFootprint}), not the declaration: a declared `changes[]`
 * is a lower bound on what a Story will touch, and two Stories whose real edits
 * collide were being co-dispatched whenever the collision was not predicted
 * (Story #4875).
 *
 * **A glob footprint overlaps EVERYTHING** → `true` (Story #4539/#4540).
 * Comparison is exact-string, so a Story declaring `.agents/scripts/lib/**`
 * would not match another declaring `.agents/scripts/lib/story-adjacency.js` —
 * the guard would silently pass two Stories that genuinely race. Unknown width
 * is not the same as no width: fail safe by serializing the rest of the beat.
 *
 * That fail-safe is **beat-local and stays that way**. The cross-beat
 * reservation uses {@link reservesConcretePath} instead, because a beat is a
 * moment and an in-flight window is an implementation (Story #4960).
 *
 * @param {StoryRecord} a
 * @param {StoryRecord} b
 * @returns {boolean}
 */
export function storiesOverlap(a, b) {
  const pair = widenedFootprintPair(a, b);
  if (pair === null) return false;
  const [fa, fb] = pair;
  for (const path of fa) {
    if (isGlobPath(path) || fb.has(path)) return true;
  }
  for (const path of fb) {
    if (isGlobPath(path)) return true;
  }
  return false;
}

/**
 * **Cross-beat** reservation guard: `true` only when the two widened
 * footprints share a **concrete** (non-glob) path.
 *
 * A Story dispatched on an earlier beat holds its footprint for its entire
 * implementation window, not for a moment, so the two guards cannot share a
 * predicate (Story #4960):
 *
 *   - A **concrete** shared path is a real, named collision — two branches
 *     editing `lib/foo.js` conflict at close whether the peer was admitted
 *     alongside or hours ago. It reserves, exactly as Story #4950 shipped.
 *   - A **glob** — or the UNKNOWN sentinel `resolve-stories.js` substitutes
 *     for an unparseable body — names no file. Reserving on it withheld every
 *     eligible Story against a single unknown-width blocker for that blocker's
 *     whole window, which is strictly worse than the serial run the
 *     reservation was meant to speed up. Glob paths are therefore skipped on
 *     both sides here; the beat-local {@link storiesOverlap} fail-safe is
 *     unchanged and still serializes them within a beat.
 *
 * Set intersection is symmetric, so scanning the reserving side alone finds
 * every shared concrete path.
 *
 * @param {StoryRecord} held      The in-flight Story holding the reservation.
 * @param {StoryRecord} candidate The Story being considered for admission.
 * @returns {boolean}
 */
function reservesConcretePath(held, candidate) {
  const pair = widenedFootprintPair(held, candidate);
  if (pair === null) return false;
  const [fa, fb] = pair;
  for (const path of fa) {
    if (!isGlobPath(path) && fb.has(path)) return true;
  }
  return false;
}

/**
 * Select the set of Stories safe to dispatch on this beat.
 *
 * Algorithm (continuous, dependency-driven — no wave barrier):
 *
 *   1. **Adjacency.** Re-derive `Map<id, depIds[]>` from the supplied
 *      records via `buildStoryAdjacency`. The `dropForeign` flag controls
 *      how a dependency on an id **outside** the supplied set is treated:
 *      - `dropForeign: false` (default, standalone-path semantics) — the
 *        foreign dependency still gates the dependent: an absent dependency
 *        is treated as not-yet-done and withholds the dependent until it
 *        completes (preserves the operator-DAG contract).
 *      - `dropForeign: true` (Epic-path semantics) — a foreign edge is
 *        pruned so the DAG stays closed over the scheduled Story set. An
 *        Epic's Stories depend only on siblings, so a `blocked by #N` whose
 *        target is out-of-scope (a foreign id, or a typo) must be dropped,
 *        not treated as a permanent unsatisfiable gate — otherwise the
 *        dependent Story is never schedulable and the run silently strands
 *        it. This matches `build-wave-dag.js`, which builds the Epic
 *        wave DAG with the same default-`dropForeign` builder.
 *   2. **Done set.** Union the caller-supplied `doneIds` with every record
 *      that classifies as `done` (live label / closed issue). A Story's
 *      dependency counts as satisfied iff it is in this union.
 *   3. **Eligibility.** A Story is *eligible* when it classifies as `ready`
 *      (not done / blocked / executing) **and** every one of its
 *      dependencies is in the done set. This is the no-false-barrier
 *      property: C depending only on A is eligible the instant A is done,
 *      even while an unrelated B is still pending.
 *   4. **Capacity.** The dispatch set never exceeds `slots = max(0,
 *      globalCap − inFlight)`. `inFlight` is the caller's count of Stories
 *      already occupying a slot (executing / closing / dispatched-not-yet-
 *      labelled). When `slots <= 0`, the result is empty.
 *   5. **Overlap guard.** Greedily admit eligible Stories in ascending-id
 *      order, skipping any whose file footprint overlaps a Story **already
 *      admitted this beat** ({@link storiesOverlap}) or shares a **concrete**
 *      path with a Story **still in flight from an earlier beat**
 *      (`inFlightRecords`, {@link reservesConcretePath}). A withheld Story
 *      stays eligible and is naturally re-considered on the next beat once
 *      the Story reserving its files has cleared.
 *
 * The result is deterministic: eligible Stories are considered in
 * ascending-id order, so the same inputs always yield the same set.
 *
 * @param {object} args
 * @param {StoryRecord[]} args.stories  Live Story records in scope.
 * @param {Array<number|string>|Set<number|string>} [args.doneIds]
 *   Ids the caller already knows are done (e.g. from a prior beat). Merged
 *   with records that classify as done.
 * @param {number} [args.inFlight=0]    Count of Stories already occupying a
 *   slot. Subtracted from `globalCap` to compute remaining capacity.
 * @param {number} args.globalCap       Hard ceiling on total concurrent
 *   Stories.
 * @param {boolean} [args.dropForeign=false] Adjacency closure policy (see
 *   step 1 above). `false` keeps a foreign dependency as a gate
 *   (standalone / operator-DAG semantics); `true` prunes foreign edges so
 *   the DAG stays closed over the scheduled set (Epic semantics).
 * @param {StoryRecord[]} [args.inFlightRecords=[]] Records for the Stories
 *   already in flight, whose **concrete** footprint paths this beat must
 *   **reserve** rather than merely count. `inFlight` is a number and can only
 *   shrink capacity; without the records a Story admitted now can share files
 *   with one dispatched on an earlier beat and still implementing — a
 *   guaranteed merge conflict at close (Story #4950). A glob / UNKNOWN
 *   footprint reserves nothing (Story #4960). Callers that hold only ids (the
 *   `--dag`/`--in-flight` flag mode) pass nothing and get the pre-#4950
 *   same-beat-only behaviour.
 * @returns {{ selected: StoryRecord[], withheldByInFlight: Array<{id: number, blockedBy: number}> }}
 *   `selected` is the dispatch set: a subset of `stories`, ascending by id,
 *   overlap-free, length ≤ `globalCap − inFlight`. `withheldByInFlight`
 *   names each eligible Story a reservation held back and the in-flight
 *   Story that holds it.
 */
export function planReadySet({
  stories,
  doneIds = [],
  inFlight = 0,
  globalCap,
  dropForeign = false,
  inFlightRecords = [],
} = {}) {
  const records = Array.isArray(stories) ? stories : [];
  const cap = Number.isInteger(globalCap) ? globalCap : 0;
  const inFlightCount =
    Number.isInteger(inFlight) && inFlight > 0 ? inFlight : 0;
  const slots = Math.max(0, cap - inFlightCount);
  if (slots <= 0 || records.length === 0) {
    return { selected: [], withheldByInFlight: [] };
  }

  // Step 1 — adjacency keyed by id. The `dropForeign` policy decides whether
  // a dependency on an id outside the supplied set gates the dependent
  // (false) or is pruned (true). See the JSDoc above for the per-path
  // rationale.
  const adjacency = buildStoryAdjacency(records, { dropForeign });

  // Step 2 — done set = caller-supplied ids ∪ records that classify done.
  const done = new Set();
  for (const raw of doneIds instanceof Set ? doneIds : (doneIds ?? [])) {
    const id = Number(raw);
    if (Number.isInteger(id)) done.add(id);
  }
  const byId = new Map();
  for (const rec of records) {
    const id = storyIdOf(rec);
    if (id === null) continue;
    byId.set(id, rec);
    if (classifyStory(rec) === 'done') done.add(id);
  }

  // Step 3 — eligible: ready AND all dependencies done. Ascending id for
  // deterministic admission order.
  const eligibleIds = [];
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    const rec = byId.get(id);
    if (classifyStory(rec) !== 'ready') continue;
    const deps = adjacency.get(id) ?? [];
    if (deps.every((dep) => done.has(dep))) eligibleIds.push(id);
  }

  // Steps 4 + 5 — greedily admit up to `slots`, skipping file-overlap
  // collisions against the already-admitted set AND against the footprints
  // reserved by Stories still in flight from an earlier beat.
  return admitStories({
    eligibleIds,
    byId,
    slots,
    reserved: Array.isArray(inFlightRecords) ? inFlightRecords : [],
  });
}

/**
 * Greedily admit eligible Stories in ascending-id order under two distinct
 * withholding rules, and report which ones a reservation held back.
 *
 * The two rules are distinct predicates, not one applied twice: the
 * cross-beat reservation matches only a shared **concrete** path
 * ({@link reservesConcretePath}), while the same-beat guard also serializes
 * unknown-width footprints ({@link storiesOverlap}). See both for why.
 *
 * The reservation check runs **first**, so a Story racing both an in-flight
 * Story and a same-beat peer is reported against the in-flight one: that is
 * the longer-lived and more informative blocker (a Story that has been
 * implementing for beats, not one merely admitted a moment ago), and checking
 * it first is what makes the report complete — every withheld-by-reservation
 * Story appears in it. Ordering cannot change `selected`: a candidate either
 * rule rejects is skipped whichever runs first; only which list it is
 * reported in depends on the order.
 *
 * @param {object} args
 * @param {number[]} args.eligibleIds        Ascending eligible Story ids.
 * @param {Map<number, StoryRecord>} args.byId
 * @param {number} args.slots                Remaining dispatch capacity.
 * @param {StoryRecord[]} args.reserved      In-flight Story records.
 * @returns {{ selected: StoryRecord[], withheldByInFlight: Array<{id: number, blockedBy: number}> }}
 */
function admitStories({ eligibleIds, byId, slots, reserved }) {
  const selected = [];
  const withheldByInFlight = [];
  for (const id of eligibleIds) {
    if (selected.length >= slots) break;
    const rec = byId.get(id);
    const blockedBy = findInFlightBlocker(rec, id, reserved);
    if (blockedBy !== null) {
      withheldByInFlight.push({ id, blockedBy });
      continue;
    }
    if (selected.some((picked) => storiesOverlap(picked, rec))) continue;
    selected.push(rec);
  }
  return { selected, withheldByInFlight };
}

/**
 * The id of the in-flight Story whose widened footprint reserves a concrete
 * path the candidate would race, or `null` when none does.
 *
 * Two records are skipped rather than treated as blockers:
 *
 *   - **The candidate itself.** Probe mode hands the whole record set to both
 *     arguments, and an in-flight Story classifies `executing` rather than
 *     `ready`, so a candidate can never legitimately appear here — but a
 *     caller that double-lists one Story must not have it withhold itself.
 *   - **An unidentifiable record.** A withholding this function cannot name
 *     is one the envelope cannot explain, and an unexplained unfilled slot is
 *     the exact operator-facing failure this reservation exists to remove.
 *     Probe-mode records always carry an integer id, so this is defensive.
 *
 * @param {StoryRecord} candidate
 * @param {number} candidateId
 * @param {StoryRecord[]} reserved
 * @returns {number|null}
 */
function findInFlightBlocker(candidate, candidateId, reserved) {
  for (const held of reserved) {
    const heldId = storyIdOf(held);
    if (heldId === null || heldId === candidateId) continue;
    if (reservesConcretePath(held, candidate)) return heldId;
  }
  return null;
}
