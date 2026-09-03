/**
 * Fixture source for `tests/baselines/refresh-service.api.test.js`.
 *
 * The default-scorer test needs a *real* directory for the registered
 * maintainability scorer to walk — the scorer resolves `targetDirs` from the
 * `.agentrc.json` beside this tree. Two small, deterministic files keep that
 * walk to two escomplex analyses instead of the repository's own
 * `.agents/scripts` tree (~1.1 GB peak RSS across an 18-worker pool).
 *
 * Keep these trivial: their only contract is "scores, and scores the same
 * every run".
 */
export function add(a, b) {
  return a + b;
}
