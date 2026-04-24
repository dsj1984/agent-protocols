import { createGitInterface } from './git-utils.js';

/**
 * Resolve the list of files changed since `ref` relative to the current HEAD.
 *
 * Used by `check-crap.js` and `check-maintainability.js` to implement the
 * `--changed-since <ref>` diff-scoped mode — the quality gates limit both
 * scoring and comparison to this file set so the pre-push / PR CI feedback
 * loop stays fast on large consumer repos.
 *
 * Semantics:
 *   - Runs `git diff --name-only <ref>...HEAD` so the comparison is against
 *     the merge-base (three-dot range). This matches how GitHub computes the
 *     "files changed" view for a PR and deliberately excludes anything that
 *     was merged into the base branch after the PR branched off.
 *   - Returns relative paths with forward-slash separators so set-membership
 *     checks line up with the normalized paths produced by `scanAndScore` and
 *     `calculateAll` on Windows checkouts.
 *   - A non-zero git exit is surfaced as a thrown Error — `--changed-since`
 *     must **never** silently degrade to "no regressions found"; that is the
 *     entire reason the CLIs fail closed on a bad ref.
 *
 * @param {object} [params]
 * @param {string} [params.ref='main']         The ref to diff against.
 * @param {string} [params.cwd=process.cwd()]  Repo working directory.
 * @param {ReturnType<typeof createGitInterface>} [params.git] Injected git
 *   interface — production callers omit this; tests pass a mock.
 * @returns {string[]} Relative, forward-slash-normalized file paths. Order is
 *   whatever `git diff --name-only` produces (stable per invocation).
 * @throws {Error} When git exits non-zero (unresolvable ref, corrupt repo,
 *   etc.). The error message names the ref so the operator can react without
 *   re-reading the CLI flags.
 */
export function getChangedFiles({
  ref = 'main',
  cwd = process.cwd(),
  git,
} = {}) {
  const gitIface = git ?? createGitInterface({});
  const res = gitIface.gitSpawn(cwd, 'diff', '--name-only', `${ref}...HEAD`);
  if (res.status !== 0) {
    const detail = res.stderr || res.stdout || `exit ${res.status}`;
    throw new Error(
      `[changed-since] unable to resolve ref "${ref}": ${detail}`,
    );
  }
  if (!res.stdout) return [];
  return res.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\\/g, '/'));
}
