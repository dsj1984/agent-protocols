/**
 * CommitAssertion — post-wave check that every "done" Story has at least one
 * new commit on `origin/story-<id>` relative to `origin/epic/<epicId>`.
 *
 * Stories that report `done` with zero new commits are reclassified as
 * `failed` with `commit-assertion: zero-delta` before the wave-end structured
 * comment is emitted, so the Epic's telemetry matches reality.
 *
 * The git read is performed by an **injected adapter** so the module is
 * testable without a real repo or subprocess:
 *
 *   async gitAdapter({ epicId, storyId }) => number  // new commit count
 *
 * A default adapter backed by `git rev-list --count` is exported for the
 * runtime wiring site.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export class CommitAssertion {
  /**
   * @param {{
   *   ctx?: { gitAdapter?: Function, logger?: { warn?: Function } },
   *   gitAdapter?: (args: { epicId: number, storyId: number }) => Promise<number>,
   *   logger?: { warn?: Function },
   * }} opts
   */
  constructor(opts = {}) {
    const ctx = opts.ctx;
    const gitAdapter = opts.gitAdapter ?? ctx?.gitAdapter;
    if (typeof gitAdapter !== 'function') {
      throw new TypeError('CommitAssertion requires a gitAdapter function');
    }
    this.gitAdapter = gitAdapter;
    this.logger = opts.logger ?? ctx?.logger ?? console;
  }

  /**
   * Count new commits on each story branch relative to the epic base.
   *
   * @param {number[]} storyIds
   * @param {{ epicId: number }} opts
   * @returns {Promise<Array<{ storyId: number, newCommitCount: number | null, error?: string }>>}
   */
  async check(storyIds, { epicId } = {}) {
    if (!Number.isInteger(epicId)) {
      throw new TypeError('CommitAssertion.check requires a numeric epicId');
    }
    const ids = Array.isArray(storyIds) ? storyIds : [];
    const results = [];
    for (const raw of ids) {
      const storyId = Number(raw);
      if (!Number.isInteger(storyId)) {
        results.push({
          storyId: raw,
          newCommitCount: null,
          error: 'invalid storyId',
        });
        continue;
      }
      try {
        const count = await this.gitAdapter({ epicId, storyId });
        const n = Number(count);
        results.push({
          storyId,
          newCommitCount: Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0,
        });
      } catch (err) {
        const msg = err?.message ?? String(err);
        this.logger?.warn?.(
          `[CommitAssertion] git lookup for #${storyId} failed: ${msg}`,
        );
        results.push({ storyId, newCommitCount: null, error: msg });
      }
    }
    return results;
  }
}

/**
 * Default git adapter — runs `git rev-list --count
 * origin/epic/<epicId>..origin/story-<storyId>` in `cwd` and returns the
 * integer count. Missing refs surface as a thrown error that
 * `CommitAssertion.check` records on the row.
 *
 * @param {{
 *   cwd?: string,
 *   execFileImpl?: typeof execFileCb,
 *   storyBranchPattern?: (storyId: number) => string,
 *   epicBranchPattern?: (epicId: number) => string,
 * }} opts
 */
export function buildDefaultGitAdapter(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const runner = opts.execFileImpl ? promisify(opts.execFileImpl) : execFile;
  const storyBranchPattern =
    opts.storyBranchPattern ?? ((id) => `origin/story-${id}`);
  const epicBranchPattern =
    opts.epicBranchPattern ?? ((id) => `origin/epic/${id}`);

  return async function defaultGitAdapter({ epicId, storyId }) {
    const range = `${epicBranchPattern(epicId)}..${storyBranchPattern(storyId)}`;
    const { stdout } = await runner('git', ['rev-list', '--count', range], {
      cwd,
      windowsHide: true,
    });
    const n = Number(String(stdout).trim());
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`unexpected rev-list output: "${stdout}"`);
    }
    return Math.trunc(n);
  };
}

export const COMMIT_ASSERTION_ZERO_DELTA_DETAIL =
  'commit-assertion: zero-delta';
