/**
 * `qa.gherkinLint` accessor — the static Gherkin corpus gate's contract.
 *
 * The gate is **opt-in**: absent this block, `check-gherkin-corpus.js` reports
 * that it is not configured and exits 0. That is not politeness. `.agents/`
 * reaches a consumer by plain file copy, so every framework upgrade lands this
 * gate in every project at once; a default-on corpus lint would redden the
 * `lint` required check of every repo that happens to own a `.feature` file it
 * never asked the framework to police.
 *
 * Inside the opt-in the posture inverts and the gate fails **closed** — an
 * unresolvable parser or a scope that resolves no step definitions is an
 * error, never a quiet pass. Both are the same blackout the gate exists to
 * catch, wearing a different costume.
 *
 * Scopes are the load-bearing shape. Pooling every step root into one matcher
 * list makes a cross-app false bind possible: a step defined only in app B's
 * suite silently vouches for app A's feature, and the gate reports green on a
 * corpus that cannot generate. Resolving each feature against **its own**
 * scope's step roots makes that structurally impossible rather than merely
 * unlikely.
 */

/**
 * Framework defaults for the two escape hatches. `@skip` is the conventional
 * "not meant to run" tag across cucumber-js and playwright-bdd, so it is the
 * default exemption; the waiver list starts empty because every entry is a
 * project-specific admission that the step index guessed wrong.
 */
const GHERKIN_LINT_DEFAULTS = Object.freeze({
  exemptionTags: Object.freeze(['@skip']),
  stepWaivers: Object.freeze([]),
});

/** Coerce a value to an array of non-empty strings. */
function stringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item) => typeof item === 'string' && item.length > 0);
}

/**
 * Normalize one scope entry into `{ name, featureRoots, stepRoots }`.
 *
 * @param {string} name
 * @param {object} raw
 * @returns {{ name: string, featureRoots: string[], stepRoots: string[] }}
 */
function normalizeScope(name, raw) {
  return {
    name,
    featureRoots: stringArray(raw?.featureRoots, []),
    stepRoots: stringArray(raw?.stepRoots, []),
  };
}

/**
 * Normalize a raw `qa.gherkinLint` block.
 *
 * @param {object | null | undefined} raw
 * @returns {{
 *   scopes: Array<{ name: string, featureRoots: string[], stepRoots: string[] }>,
 *   exemptionTags: string[],
 *   stepWaivers: string[],
 * } | null} `null` when the block is absent or not an object
 */
function resolveGherkinLint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const scopesRaw =
    raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)
      ? raw.scopes
      : {};
  return {
    scopes: Object.keys(scopesRaw)
      .sort()
      .map((name) => normalizeScope(name, scopesRaw[name])),
    exemptionTags: stringArray(
      raw.exemptionTags,
      GHERKIN_LINT_DEFAULTS.exemptionTags,
    ),
    stepWaivers: stringArray(
      raw.stepWaivers,
      GHERKIN_LINT_DEFAULTS.stepWaivers,
    ),
  };
}

/**
 * Read the normalized `qa.gherkinLint` contract off a resolved config.
 *
 * @param {object | null | undefined} config
 * @returns {ReturnType<typeof resolveGherkinLint>}
 */
export function getGherkinLint(config) {
  return resolveGherkinLint(config?.qa?.gherkinLint);
}

/**
 * Module-private surface the suite drives directly, bundled behind one export
 * for the same reason as `bdd-step-index.js`: `getGherkinLint` is the whole
 * public API, and the normalizer and its defaults are how it is built.
 */
export const __testing = Object.freeze({
  GHERKIN_LINT_DEFAULTS,
  resolveGherkinLint,
});
