/**
 * lib/wave-runner/footprint.js — what a Story is going to touch, and what two
 * Stories would touch in common.
 *
 * Split out of `ready-set.js` (Story #5044), which is the *scheduling* kernel:
 * eligibility, capacity, admission order. Deciding whether two Stories collide
 * is a separate question with its own rules — what counts as a declaration,
 * what counts as evidence, what a glob means, and which text is edit intent
 * rather than machine-generated noise — and it had grown large enough inside
 * the scheduler to obscure both.
 *
 * The layer has exactly one job: given two Story records, say whether their
 * file footprints intersect, name the paths, and say whether a declaration or
 * the text scrape produced the answer. It reads nothing and mutates nothing.
 *
 * @module lib/wave-runner/footprint
 */

/**
 * Why two footprints collided.
 *
 * `declared-overlap` — at least one colliding path was **declared** by both
 * Stories (or is a declared glob). This is the guard doing its intended job:
 * two Stories that both list `baselines/maintainability.json` really do have to
 * be serialized, and no amount of scrape-narrowing should change that.
 *
 * `scraped-overlap` — every colliding path reached the comparison through the
 * evidence widening rather than a declaration. Still a real signal (Story
 * #4875 exists because declarations are systematically a lower bound), but it
 * is the class where a false positive is possible, so it is the one an operator
 * should be able to see and — via `footprintGuard: 'advisory'` — choose not to
 * enforce.
 */
export const OVERLAP_SOURCES = Object.freeze({
  DECLARED: 'declared-overlap',
  SCRAPED: 'scraped-overlap',
});

/**
 * Repo-relative file paths as they appear in Story prose: at least one `/`
 * separator and a short file extension. Deliberately narrow — a token has to
 * look like a real path before it can widen a footprint and withhold a Story.
 */
const PROSE_PATH_RE = /(?:[\w.@~-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,6}/g;

/**
 * The **machine-generated audit provenance footers** — and nothing else.
 *
 * `/audit-to-stories` and `plan-persist` stamp `<!-- audit-fingerprints: … -->`
 * and `<!-- audit-semantic-keys: … -->` onto a Story body as dedup identity.
 * A semantic key is `area␟primaryFile`, and that `␟` (U+241F) separator is
 * outside {@link PROSE_PATH_RE}'s character class, so the `primaryFile` half
 * matches as a standalone path token. `plan-persist` carries the **sweep-wide
 * union** of those footers onto every sibling of an audit-derived plan, so
 * every pair of that plan shared path-shaped tokens neither Story would edit —
 * measured at 10/10 colliding pairs, 0/10 once these blocks are ignored
 * (issue #5040).
 *
 * **This is surgical on purpose: a blanket HTML-comment strip would be wrong.**
 * `.agents/instructions.md` § 7 puts a complexity decomposition's numbered
 * sub-steps inside a `<!-- DECOMPOSITION -->` block, and the paths a sub-step
 * names are exactly the edit intent this layer exists to read. Only the two
 * provenance markers below are removed; every other comment stays evidence.
 */
const PROVENANCE_FOOTER_RE =
  /<!--\s*audit-(?:fingerprints|semantic-keys)\s*:[\s\S]*?-->/g;

/**
 * The URL interior of a markdown inline link (`](…)`), with an optional title.
 * A link target is a *citation* — "see [the spec](docs/architecture.md)" — not
 * a declaration that this Story will edit that file, and generated bodies cite
 * the same source report from every sibling. The link **text** is left intact:
 * a human writing "the caller in [`bin/mandrel.js`](bin/mandrel.js)" is naming
 * an edit target in the prose half, and that half still counts.
 */
const MARKDOWN_LINK_URL_RE = /\]\(\s*[^)\s]*(?:\s+"[^"]*")?\s*\)/g;

/** Default gitignored scratch root when no `project.paths.tempRoot` is threaded. */
const DEFAULT_TEMP_ROOT = 'temp';

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
 * no declared footprint yields an empty set, which (by {@link detectCollision}'s
 * contract) means it overlaps with nothing and is never withheld.
 *
 * @param {object} story
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
    const trimmed = path?.trim();
    if (trimmed) out.add(trimmed);
  };
  for (const shape of [story?.files, story?.changes, story?.changeset]) {
    if (Array.isArray(shape)) for (const entry of shape) push(entry);
  }
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
 * Is this path inside the gitignored temp root?
 *
 * `project.paths.tempRoot` is scratch space by contract
 * ([`.agents/instructions.md`](../../../instructions.md) § 6): nothing under it
 * is ever committed, so it can never be a delivery write target, and two
 * Stories naming the same `temp/audits/audit-<lens>-results.md` source report
 * are not racing anything. The match is rooted, not a substring test, so a real
 * deliverable like `lib/temperature.js` is untouched.
 *
 * @param {string} path
 * @param {string} tempRoot
 * @returns {boolean}
 */
function isUnderTempRoot(path, tempRoot) {
  if (!tempRoot) return false;
  const normalized = path.replace(/^\.\//, '');
  return normalized === tempRoot || normalized.startsWith(`${tempRoot}/`);
}

/**
 * Scrape file paths a Story's **text** mentions but its `changes[]` never
 * declared (Story #4875), **narrowed to text that expresses edit intent**
 * (Story #5044).
 *
 * The declared footprint is a planner's *prediction*, and it is systematically
 * a lower bound: a Story's `## Spec` names the module it must also touch, its
 * acceptance criteria name the caller that must be updated, and none of that
 * reaches `changes[]`. The overlap guard exists to stop two Stories racing the
 * same file, so trusting the declaration outright means the guard is blind to
 * precisely the collisions nobody predicted.
 *
 * But the converse failure is just as real: a path-shaped token that no human
 * wrote as intent manufactures a collision, and a manufactured collision
 * serializes a run that had no reason to be serial. Three token sources are
 * therefore excluded before the scrape, each because it is *structurally*
 * incapable of naming an edit target:
 *
 *   1. **Audit provenance footers** ({@link PROVENANCE_FOOTER_RE}) — machine-
 *      stamped dedup identity, unioned sweep-wide across siblings.
 *   2. **Markdown-link URLs** ({@link MARKDOWN_LINK_URL_RE}) — citations.
 *   3. **Paths under the temp root** ({@link isUnderTempRoot}) — gitignored
 *      scratch, never a write target.
 *
 * Evidence is only ever **added** to the declaration — nothing here can shrink
 * a declared footprint, so `changes[]` remains a lower bound (Story #4875) and
 * narrowing the scrape can never co-dispatch a pair the declared comparison
 * would have caught.
 *
 * @param {object} story
 * @param {object} [options]
 * @param {string} [options.tempRoot='temp'] Resolved `project.paths.tempRoot`.
 * @returns {Set<string>}
 */
function storyEvidencePaths(story, { tempRoot = DEFAULT_TEMP_ROOT } = {}) {
  const out = new Set();
  for (const field of [story?.title, story?.body, story?.spec]) {
    if (typeof field !== 'string') continue;
    const scannable = field
      .replace(PROVENANCE_FOOTER_RE, ' ')
      .replace(MARKDOWN_LINK_URL_RE, ']()');
    for (const [token] of scannable.matchAll(PROSE_PATH_RE)) {
      if (!isUnderTempRoot(token, tempRoot)) out.add(token);
    }
  }
  return out;
}

/**
 * A Story's declared footprint **and** the evidence-widened one.
 *
 * Both are returned because they answer different questions. `widened` decides
 * *whether* two Stories collide; `declared` decides *how to describe* the
 * collision — a path both Stories declared is intended serialization (two
 * Stories that really do rewrite the same generated baseline), while one only
 * the scrape produced may be an artifact of how a body was worded. An operator
 * reading an unfilled slot needs to tell those apart.
 *
 * @param {object} story
 * @param {object} [options]
 * @returns {{ declared: Set<string>, widened: Set<string> }}
 */
function storyFootprints(story, options) {
  const declared = storyFootprint(story);
  const widened = new Set(declared);
  for (const path of storyEvidencePaths(story, options)) widened.add(path);
  return { declared, widened };
}

/**
 * Record one colliding path, remembering whether **any** occurrence of it was
 * declaration-backed.
 *
 * `declared` is tracked per path rather than per pair because the two hit kinds
 * qualify differently: a shared **concrete** path counts as declared only when
 * both sides declared it, whereas a **glob** names no file to share and counts
 * as declared when its own side declared it. The scraper cannot emit a glob —
 * prose globs are narrative ("everything under `.agents/**`") and never match
 * {@link PROSE_PATH_RE} — so a glob hit is essentially always declared width
 * failing safe, and labelling it `scraped` would make advisory mode read as if
 * the text widening had caused it.
 *
 * @param {Map<string, boolean>} hits
 * @param {string} path
 * @param {boolean} declared
 */
function recordHit(hits, path, declared) {
  hits.set(path, (hits.get(path) ?? false) || declared);
}

/**
 * Collect the glob paths on one side. A glob is unknown width, and unknown
 * width is not no width: within a beat it collides with everything, because
 * exact-string comparison would silently pass a Story declaring
 * `.agents/scripts/lib/**` alongside one declaring a file underneath it
 * (Story #4539/#4540).
 *
 * @param {Map<string, boolean>} hits
 * @param {{ declared: Set<string>, widened: Set<string> }} side
 */
function recordGlobs(hits, side) {
  for (const path of side.widened) {
    if (isGlobPath(path)) recordHit(hits, path, side.declared.has(path));
  }
}

/**
 * The colliding paths between two Stories' widened footprints, tagged with
 * whether a declaration produced the collision — or `null` when they do not
 * collide.
 *
 * **An empty footprint means "no known overlap"**, so this short-circuits to
 * `null` on one. That is permissive by necessity: a Story with no declared
 * footprint and no path evidence in its text carries no information, and
 * withholding on absence would serialize every run.
 *
 * `concreteOnly` selects between the two guards' deliberately different
 * treatment of unknown width (Story #4960). The beat-local guard counts a glob
 * on either side as colliding with everything; the cross-beat reservation
 * ignores globs entirely, because an in-flight Story holds its footprint for a
 * whole implementation window and one glob would otherwise withhold the entire
 * run for hours — and `resolve-stories.js` substitutes an UNKNOWN sentinel for
 * any body it cannot parse, so one malformed Story would make a run serial.
 *
 * @param {object} a
 * @param {object} b
 * @param {object} [options]
 * @param {boolean} [options.concreteOnly=false] Skip glob paths on both sides.
 * @param {string} [options.tempRoot]
 * @returns {{ paths: string[], source: string }|null}
 */
export function detectCollision(
  a,
  b,
  { concreteOnly = false, ...evidence } = {},
) {
  const fa = storyFootprints(a, evidence);
  if (fa.widened.size === 0) return null;
  const fb = storyFootprints(b, evidence);
  if (fb.widened.size === 0) return null;

  const hits = new Map();
  for (const path of fa.widened) {
    if (!isGlobPath(path) && fb.widened.has(path)) {
      recordHit(hits, path, fa.declared.has(path) && fb.declared.has(path));
    }
  }
  if (!concreteOnly) {
    recordGlobs(hits, fa);
    recordGlobs(hits, fb);
  }
  if (hits.size === 0) return null;
  return {
    paths: [...hits.keys()].sort(),
    source: [...hits.values()].some(Boolean)
      ? OVERLAP_SOURCES.DECLARED
      : OVERLAP_SOURCES.SCRAPED,
  };
}
