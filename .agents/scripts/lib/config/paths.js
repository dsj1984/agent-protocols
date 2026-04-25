/**
 * `agentSettings.paths` accessor (Epic #730 Story 7; relocated under
 * lib/config/ in Epic #773 Story 6).
 */

/**
 * Framework defaults for `agentSettings.paths` (Epic #730 Story 7).
 * Only the optional `auditOutputDir` has a default — the three required
 * roots are schema-enforced and the resolver never silently fills them in.
 */
export const PATHS_DEFAULTS = Object.freeze({
  auditOutputDir: 'temp',
});

/**
 * Merge a user-supplied `paths` block with framework defaults. Required
 * roots (`agentRoot` / `docsRoot` / `tempRoot`) flow through verbatim —
 * the schema rejects a config that omits them. `auditOutputDir` falls back
 * to {@link PATHS_DEFAULTS}.
 *
 * @param {object|undefined} userPaths
 * @returns {{ agentRoot?: string, docsRoot?: string, tempRoot?: string, auditOutputDir: string }}
 */
export function resolvePaths(userPaths) {
  const paths = userPaths && typeof userPaths === 'object' ? userPaths : {};
  return {
    agentRoot: paths.agentRoot,
    docsRoot: paths.docsRoot,
    tempRoot: paths.tempRoot,
    auditOutputDir: paths.auditOutputDir ?? PATHS_DEFAULTS.auditOutputDir,
  };
}

/**
 * Read the merged `agentSettings.paths` block. Accepts either the full
 * resolved config or the bare `agentSettings` bag.
 *
 * @param {{ agentSettings?: { paths?: object } } | object | null | undefined} config
 * @returns {ReturnType<typeof resolvePaths>}
 */
export function getPaths(config) {
  const userPaths = config?.agentSettings?.paths ?? config?.paths ?? undefined;
  return resolvePaths(userPaths);
}
