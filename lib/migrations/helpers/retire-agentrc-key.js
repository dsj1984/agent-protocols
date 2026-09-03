// lib/migrations/helpers/retire-agentrc-key.js
/**
 * The shared scaffold behind every "strip a retired `.agentrc.json` key"
 * migration step.
 *
 * Retiring a config key is the framework's most common migration: a key is
 * dropped from the runtime AJV schema, the block it lived under carries
 * `additionalProperties: false`, and a consumer whose config still sets it
 * hits a hard validation failure on upgrade rather than a warning. Every such
 * step reads the config, decides whether the key is present, deletes it,
 * prunes whatever containers that emptied, and writes the file back — the
 * same mechanics each time, previously copy-pasted per step (jscpd recorded
 * five of them between 48 and 58 percent duplicated).
 *
 * Only three things actually vary between steps, so only those three are
 * declared:
 *
 *   - **which config surfaces to sweep** — `.agentrc.json` alone, or that plus
 *     the gitignored `.agentrc.local.json`. `config-resolver.js` deep-merges
 *     the overlay over the base *before* the AJV gate runs, so a key surviving
 *     in the overlay fails exactly as a base one would. A step that swept only
 *     the base would report "nothing to migrate" and leave that consumer hard
 *     broken with no self-service remedy.
 *   - **which key paths are retired** — a step may retire more than one.
 *   - **how far to prune emptied ancestors** — this is deliberately per-key
 *     and not a global policy. `planning` is optional, so an emptied
 *     `planning` block is removed; `project` is required and an empty
 *     `commands` object is valid against the schema, so pruning it would be a
 *     cosmetic edit to a config the consumer owns.
 *
 * Builtins only, and the `fs` seam stays injectable via `ctx.fs`, because
 * these steps run during `mandrel update` before third-party packages are
 * guaranteed to be present.
 */

import nodeFs from 'node:fs';
import path from 'node:path';

/** The committed config every consumer has. */
export const AGENTRC_BASE_FILENAME = '.agentrc.json';

/** The operator-owned, gitignored overlay the resolver merges over the base. */
const AGENTRC_LOCAL_FILENAME = '.agentrc.local.json';

/**
 * Both surfaces the resolver reads — the default sweep for a retired key.
 *
 * Module-local: a step that wants both surfaces takes the default and names
 * nothing, so exporting this would ship a symbol with no importer.
 */
const AGENTRC_FILENAMES = Object.freeze([
  AGENTRC_BASE_FILENAME,
  AGENTRC_LOCAL_FILENAME,
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
 * Read and parse one config surface. An absent or unparseable file is the
 * common case (no overlay, fresh checkout), not an error.
 *
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
 * Walk the container chain for a key path, returning every object along it.
 * Returns `null` as soon as a level is missing or is not a plain object, which
 * is what makes `hasKey` false for a config that never had the block.
 *
 * @param {object | null} config
 * @param {string[]} keyPath
 * @returns {object[] | null}
 */
function resolveContainers(config, keyPath) {
  if (!config || typeof config !== 'object') return null;
  const containers = [config];
  let cursor = config;
  for (const segment of keyPath.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object') return null;
    containers.push(next);
    cursor = next;
  }
  return containers;
}

/**
 * @param {object | null} config
 * @param {string[]} keyPath
 * @returns {boolean}
 */
function hasKey(config, keyPath) {
  const containers = resolveContainers(config, keyPath);
  if (!containers) return false;
  const leafOwner = containers[containers.length - 1];
  return Object.hasOwn(leafOwner, keyPath[keyPath.length - 1]);
}

/**
 * Delete the leaf key, then remove up to `pruneDepth` ancestors that the
 * deletion left empty. `pruneDepth: 0` deletes the key and nothing else.
 *
 * @param {object} config
 * @param {{ path: string[], pruneDepth?: number }} key
 * @returns {void}
 */
function stripKey(config, key) {
  const keyPath = key.path;
  const containers = resolveContainers(config, keyPath);
  if (!containers) return;

  const leafOwner = containers[containers.length - 1];
  delete leafOwner[keyPath[keyPath.length - 1]];

  const pruneDepth = key.pruneDepth ?? 0;
  for (let level = 0; level < pruneDepth; level += 1) {
    const index = containers.length - 1 - level;
    const emptied = containers[index];
    const parent = containers[index - 1];
    if (!parent || Object.keys(emptied).length > 0) break;
    delete parent[keyPath[index - 1]];
  }
}

/**
 * Build a migration step that strips one or more retired keys from the
 * consumer's config surfaces.
 *
 * `detect` is true when any declared key is present in any swept surface;
 * `apply` rewrites only the surfaces that actually carry one, which is what
 * makes a repeat pass a genuine no-op rather than a reformat.
 *
 * @param {{
 *   version: string,
 *   description: string,
 *   filenames?: readonly string[],
 *   keys: Array<{ path: string[], pruneDepth?: number }>,
 * }} spec
 * @returns {{
 *   version: string,
 *   description: string,
 *   detect: (ctx?: { projectRoot?: string, fs?: typeof nodeFs }) => boolean,
 *   apply: (ctx?: { projectRoot?: string, fs?: typeof nodeFs }) => void,
 * }}
 */
export function createRetireAgentrcKeyStep({
  version,
  description,
  filenames = AGENTRC_FILENAMES,
  keys,
}) {
  const carriesRetiredKey = (config) =>
    keys.some((key) => hasKey(config, key.path));

  return {
    version,
    description,
    detect(ctx) {
      const fsImpl = ctx?.fs ?? nodeFs;
      return filenames.some((filename) =>
        carriesRetiredKey(readAgentrcConfig(ctx, filename, fsImpl)),
      );
    },
    apply(ctx) {
      const fsImpl = ctx?.fs ?? nodeFs;
      for (const filename of filenames) {
        const config = readAgentrcConfig(ctx, filename, fsImpl);
        if (!carriesRetiredKey(config)) continue;

        for (const key of keys) {
          if (hasKey(config, key.path)) stripKey(config, key);
        }

        fsImpl.writeFileSync(
          resolveAgentrcPath(ctx, filename),
          `${JSON.stringify(config, null, 2)}\n`,
        );
      }
    },
  };
}
