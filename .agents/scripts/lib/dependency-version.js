/**
 * dependency-version.js — read an installed package's version without
 * evaluating the package (Story #5109).
 *
 * Baselines stamp the versions of the tools that produced them so a consumer
 * can detect scorer drift. The obvious way to get one — `require(pkg).version`
 * — pays the package's whole module-initialisation cost for a string that is
 * sitting in a manifest a few kilobytes long. For `typescript` that was ~65 ms
 * of CPU and ~75 MB of RSS on every `check-baselines --gate crap` and every
 * `quality-preview` run, in a repository with no TypeScript in it at all.
 *
 * `require.resolve` walks the resolver without reading or executing the
 * target, so everything here is path arithmetic plus one small `JSON.parse`.
 *
 * This deliberately does **not** replace `crap-utils.js#resolveEscomplexVersion`,
 * which answers a different question: it walks `node_modules` upward from a
 * caller-supplied `cwd` rather than resolving from this module's own location,
 * because the escomplex stamp must describe the tree being scanned.
 *
 * @module lib/dependency-version
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Locate a package's manifest via the module resolver, without loading it.
 *
 * The `<pkg>/package.json` subpath is tried first because it is a single
 * resolver call. A package whose `exports` map withholds `./package.json`
 * falls back to resolving the main entry and walking up to the nearest
 * `package.json`, which is still evaluation-free.
 *
 * @param {string} name Package name, e.g. `'typescript'`.
 * @param {NodeJS.Require} requireFn A `createRequire`-produced require whose
 *   resolution base is the calling module.
 * @returns {string | null} Absolute manifest path, or `null` when unresolvable.
 */
function resolveManifestPath(name, requireFn) {
  try {
    return requireFn.resolve(`${name}/package.json`);
  } catch {
    // fall through to the main-entry walk
  }
  let dir;
  try {
    dir = path.dirname(requireFn.resolve(name));
  } catch {
    return null;
  }
  const { root } = path.parse(dir);
  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve an installed package's declared version.
 *
 * Returns `null` — never a guess and never a throw — when the package cannot
 * be resolved, its manifest cannot be read or parsed, or it declares no
 * usable `version`. Callers map that onto their own sentinel (the baseline
 * writers use `'0.0.0'`, meaning "unknown environment").
 *
 * @param {string} name Package name.
 * @param {NodeJS.Require} requireFn A `createRequire`-produced require.
 * @returns {string | null}
 */
export function resolveDependencyVersion(name, requireFn) {
  const manifest = resolveManifestPath(name, requireFn);
  if (!manifest) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    if (parsed && typeof parsed.version === 'string' && parsed.version) {
      return parsed.version;
    }
  } catch {
    // unreadable / unparseable manifest
  }
  return null;
}
