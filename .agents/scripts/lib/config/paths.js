/**
 * `agentSettings.paths` accessor (Epic #730 Story 7; relocated under
 * lib/config/ in Epic #773 Story 6; extended with the seven `*Root` keys
 * in Epic #773 Story 9).
 */

/**
 * Framework defaults for `agentSettings.paths`. Required roots
 * (`agentRoot` / `docsRoot` / `tempRoot`) are schema-enforced — they have
 * no default and the resolver never silently fills them in. The optional
 * `auditOutputDir` plus the seven `*Root` directories carry framework
 * defaults that flow into the resolved config when the operator omits
 * them.
 */
export const PATHS_DEFAULTS = Object.freeze({
  auditOutputDir: 'temp',
  scriptsRoot: '.agents/scripts',
  workflowsRoot: '.agents/workflows',
  personasRoot: '.agents/personas',
  schemasRoot: '.agents/schemas',
  skillsRoot: '.agents/skills',
  templatesRoot: '.agents/templates',
  rulesRoot: '.agents/rules',
});

/**
 * Merge a user-supplied `paths` block with framework defaults. Required
 * roots (`agentRoot` / `docsRoot` / `tempRoot`) flow through verbatim —
 * the schema rejects a config that omits them. `auditOutputDir` and the
 * seven `*Root` directories fall back to {@link PATHS_DEFAULTS}.
 *
 * @param {object|undefined} userPaths
 * @returns {{
 *   agentRoot?: string,
 *   docsRoot?: string,
 *   tempRoot?: string,
 *   auditOutputDir: string,
 *   scriptsRoot: string,
 *   workflowsRoot: string,
 *   personasRoot: string,
 *   schemasRoot: string,
 *   skillsRoot: string,
 *   templatesRoot: string,
 *   rulesRoot: string,
 * }}
 */
export function resolvePaths(userPaths) {
  const paths = userPaths && typeof userPaths === 'object' ? userPaths : {};
  return {
    agentRoot: paths.agentRoot,
    docsRoot: paths.docsRoot,
    tempRoot: paths.tempRoot,
    auditOutputDir: paths.auditOutputDir ?? PATHS_DEFAULTS.auditOutputDir,
    scriptsRoot: paths.scriptsRoot ?? PATHS_DEFAULTS.scriptsRoot,
    workflowsRoot: paths.workflowsRoot ?? PATHS_DEFAULTS.workflowsRoot,
    personasRoot: paths.personasRoot ?? PATHS_DEFAULTS.personasRoot,
    schemasRoot: paths.schemasRoot ?? PATHS_DEFAULTS.schemasRoot,
    skillsRoot: paths.skillsRoot ?? PATHS_DEFAULTS.skillsRoot,
    templatesRoot: paths.templatesRoot ?? PATHS_DEFAULTS.templatesRoot,
    rulesRoot: paths.rulesRoot ?? PATHS_DEFAULTS.rulesRoot,
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
