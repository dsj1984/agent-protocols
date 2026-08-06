// lib/migrations/steps/2.32.0-retire-lint-baseline-command.js
/**
 * Story #5004 follow-up — strip the retired `project.commands.lintBaseline`
 * key from a consumer's `.agentrc.json`.
 *
 * #5004 (PR #5019) deleted `lint-baseline.js` and
 * `lib/orchestration/lint-baseline-service.js`: the CLI spawned the configured
 * command and parsed ESLint-shaped JSON, a shape this repo's own `npm run
 * lint` (Biome + markdownlint fan-out) never produced, and nothing invoked the
 * service. The key left the runtime AJV schema, the published mirror,
 * `.agentrc.json` and `agentrc-reference.json` in the same change.
 *
 * `project.commands` carries `additionalProperties: false`, so a consumer
 * whose config still sets `lintBaseline` hits a hard validation failure on
 * upgrade, not a warning. This step strips the key before that check runs —
 * the same contract-cutover pattern as `2.11.0-retire-max-seed-words.js`.
 *
 * It sweeps **both** config surfaces. `config-resolver.js` deep-merges
 * `.agentrc.local.json` over `.agentrc.json` and validates the result, so a
 * key surviving in the operator's overlay fails exactly as a base one would.
 * Sweeping only the base would report "nothing to migrate" and leave that
 * consumer hard-broken with no self-service remedy — re-running
 * `mandrel update` would keep reporting clean — while this commit's
 * `BREAKING CHANGE:` footer promises the upgrade deletes the key for them.
 *
 * The `lint` baseline KIND survives for consumers whose own linter writes
 * `baselines/lint.json`; only the framework-owned capture shell is gone, so
 * nothing here touches the baseline file or the gate config.
 *
 * This step is also the carrier for the release note #5004 never emitted: its
 * commit ships the `BREAKING CHANGE:` footer that the squash subject on `main`
 * (`227e1af4`) lacks, and which release-please therefore could not surface.
 * See `single-story-close/phases/conventional-subject.js` for the close-side
 * fix that stops the next one being lost.
 */

import nodeFs from 'node:fs';
import path from 'node:path';

/**
 * Both config surfaces the resolver reads. `.agentrc.local.json` is deep-merged
 * over the base *before* the AJV gate runs
 * (`.agents/scripts/lib/config-resolver.js`), so a `lintBaseline` surviving in
 * the overlay fails validation exactly as one in the base would — and a step
 * that swept only the base would leave that consumer hard-broken with no
 * self-service remedy, since re-running `mandrel update` would keep reporting
 * clean. The overlay is operator-owned and gitignored, which is why it is easy
 * to forget and why the sweep has to name it explicitly.
 */
const AGENTRC_FILENAMES = Object.freeze([
  '.agentrc.json',
  '.agentrc.local.json',
]);

/**
 * @param {unknown} ctx
 * @param {string} filename
 * @returns {string}
 */
function resolveAgentrcPath(ctx, filename) {
  const projectRoot = ctx?.projectRoot ?? process.cwd();
  return path.join(projectRoot, filename);
}

/**
 * @param {unknown} ctx
 * @param {typeof nodeFs} fsImpl
 * @param {string} filename
 * @returns {object | null}
 */
function readAgentrcConfig(ctx, fsImpl, filename) {
  try {
    const raw = fsImpl.readFileSync(resolveAgentrcPath(ctx, filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {object | null} config
 * @returns {boolean}
 */
function hasRetiredKey(config) {
  const commands = config?.project?.commands;
  return Boolean(commands) && Object.hasOwn(commands, 'lintBaseline');
}

export const retireLintBaselineCommand = {
  version: '2.32.0',
  description:
    'strip retired project.commands.lintBaseline from .agentrc.json ' +
    '(the framework lint-baseline capture CLI is gone — Story #5004)',
  /**
   * @param {{ projectRoot?: string, fs?: typeof nodeFs }} [ctx]
   * @returns {boolean}
   */
  detect(ctx) {
    const fsImpl = ctx?.fs ?? nodeFs;
    return AGENTRC_FILENAMES.some((filename) =>
      hasRetiredKey(readAgentrcConfig(ctx, fsImpl, filename)),
    );
  },
  /**
   * @param {{ projectRoot?: string, fs?: typeof nodeFs }} [ctx]
   * @returns {void}
   */
  apply(ctx) {
    const fsImpl = ctx?.fs ?? nodeFs;
    for (const filename of AGENTRC_FILENAMES) {
      const config = readAgentrcConfig(ctx, fsImpl, filename);
      // An absent overlay is the common case, not an error.
      if (!config || !hasRetiredKey(config)) continue;

      delete config.project.commands.lintBaseline;
      // An emptied `commands` block is left in place: unlike
      // `planning.complexityGate`, `project` is a required block and an empty
      // `commands` object is valid against the schema, so pruning it would be
      // a cosmetic edit to a config the consumer owns.

      fsImpl.writeFileSync(
        resolveAgentrcPath(ctx, filename),
        `${JSON.stringify(config, null, 2)}\n`,
      );
    }
  },
};
