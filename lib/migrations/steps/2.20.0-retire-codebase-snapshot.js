// lib/migrations/steps/2.20.0-retire-codebase-snapshot.js
/**
 * Story #4811 — strip the retired `planning.codebaseSnapshot` block from a
 * consumer's `.agentrc.json` / `.agentrc.local.json`.
 *
 * #4811 hard-cutover-removed the `/plan` codebase snapshot: the pre-computed
 * structural view grounded nothing it promised (its default include globs
 * missed the standard monorepo layout, and its knobs only re-filtered the same
 * matched set), and spec authoring is grounded instead by the author's own
 * targeted repo retrieval plus the Phase 8 `validateStoryFileAssumptions`
 * gate. The whole block was dropped from the runtime AJV schema and the
 * published mirror. `planning` carries `additionalProperties: false`, so a
 * consumer whose config still sets `codebaseSnapshot` hits a hard validation
 * failure on upgrade, not a warning. This step strips the key before that
 * check runs — the same contract-cutover pattern as
 * `2.11.0-retire-max-seed-words.js`, widened to the local override file
 * because a snapshot narrowed for one checkout is exactly the kind of knob an
 * operator pins in `.agentrc.local.json`.
 */

import nodeFs from 'node:fs';
import path from 'node:path';

/**
 * Both config files the resolver deep-merges. A key surviving in either one
 * fails validation, so both are stripped.
 */
const AGENTRC_FILENAMES = ['.agentrc.json', '.agentrc.local.json'];

const RETIRED_KEY = 'codebaseSnapshot';

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
 * @param {string} filename
 * @param {typeof nodeFs} fsImpl
 * @returns {object | null}
 */
function readAgentrcConfig(ctx, filename, fsImpl) {
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
  const planning = config?.planning;
  return Boolean(planning) && Object.hasOwn(planning, RETIRED_KEY);
}

/**
 * Strip the key and prune the containers it emptied, so a config that carried
 * nothing but the snapshot does not keep an orphan `planning: {}`.
 *
 * @param {object} config
 * @returns {void}
 */
function stripRetiredKey(config) {
  delete config.planning[RETIRED_KEY];
  if (Object.keys(config.planning).length === 0) {
    delete config.planning;
  }
}

export const retireCodebaseSnapshot = {
  version: '2.20.0',
  description:
    'strip retired planning.codebaseSnapshot from .agentrc.json / ' +
    '.agentrc.local.json (spec authoring is grounded by targeted retrieval ' +
    'plus the Phase 8 file-assumption gate — Story #4811)',
  /**
   * @param {{ projectRoot?: string, fs?: typeof nodeFs }} [ctx]
   * @returns {boolean}
   */
  detect(ctx) {
    const fsImpl = ctx?.fs ?? nodeFs;
    return AGENTRC_FILENAMES.some((filename) =>
      hasRetiredKey(readAgentrcConfig(ctx, filename, fsImpl)),
    );
  },
  /**
   * @param {{ projectRoot?: string, fs?: typeof nodeFs }} [ctx]
   * @returns {void}
   */
  apply(ctx) {
    const fsImpl = ctx?.fs ?? nodeFs;
    for (const filename of AGENTRC_FILENAMES) {
      const config = readAgentrcConfig(ctx, filename, fsImpl);
      if (!hasRetiredKey(config)) continue;

      stripRetiredKey(config);
      fsImpl.writeFileSync(
        resolveAgentrcPath(ctx, filename),
        `${JSON.stringify(config, null, 2)}\n`,
      );
    }
  },
};
