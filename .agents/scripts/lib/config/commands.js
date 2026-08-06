/**
 * `project.commands` accessor (Epic #1720 Story #1739 — top-level reshape).
 *
 * The surviving four command keys are `test`, `typecheck`,
 * `formatCheck`, `formatWrite`.
 */

export const COMMANDS_DEFAULTS = Object.freeze({
  test: 'npm test',
  typecheck: null,
  formatCheck: 'npx biome format .',
  formatWrite: 'npx biome format --write .',
});

/**
 * Read the grouped `project.commands` block, applying framework defaults
 * for any field the operator omitted. Accepts the full resolved config or
 * a bare `{ project }` bag.
 *
 * @param {object | null | undefined} config
 * @returns {{ test: string, typecheck: string|null, formatCheck: string, formatWrite: string }}
 */
export function getCommands(config) {
  const commands = config?.project?.commands ?? {};
  return {
    test: commands.test ?? COMMANDS_DEFAULTS.test,
    typecheck:
      commands.typecheck === undefined
        ? COMMANDS_DEFAULTS.typecheck
        : commands.typecheck,
    formatCheck: commands.formatCheck ?? COMMANDS_DEFAULTS.formatCheck,
    formatWrite: commands.formatWrite ?? COMMANDS_DEFAULTS.formatWrite,
  };
}
