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

const AGENTRC_FILENAME = '.agentrc.json';

/**
 * @param {unknown} ctx
 * @returns {string}
 */
function resolveAgentrcPath(ctx) {
  const projectRoot = ctx?.projectRoot ?? process.cwd();
  return path.join(projectRoot, AGENTRC_FILENAME);
}

/**
 * @param {unknown} ctx
 * @param {typeof nodeFs} fsImpl
 * @returns {object | null}
 */
function readAgentrcConfig(ctx, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(resolveAgentrcPath(ctx), 'utf8');
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
    return hasRetiredKey(readAgentrcConfig(ctx, fsImpl));
  },
  /**
   * @param {{ projectRoot?: string, fs?: typeof nodeFs }} [ctx]
   * @returns {void}
   */
  apply(ctx) {
    const fsImpl = ctx?.fs ?? nodeFs;
    const config = readAgentrcConfig(ctx, fsImpl);
    if (!config) return;

    const commands = config.project?.commands;
    if (commands && Object.hasOwn(commands, 'lintBaseline')) {
      delete commands.lintBaseline;
      // An emptied `commands` block is left in place: unlike
      // `planning.complexityGate`, `project` is a required block and an empty
      // `commands` object is valid against the schema, so pruning it would be
      // a cosmetic edit to a config the consumer owns.
    }

    fsImpl.writeFileSync(
      resolveAgentrcPath(ctx),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  },
};
