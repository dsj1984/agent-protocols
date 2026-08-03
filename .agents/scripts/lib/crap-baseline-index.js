/**
 * crap-baseline-index.js — per-file method-identity indexing over a CRAP
 * baseline's rows (Story #4981).
 *
 * Split out of `crap-engine.js` (rather than added inline) so the join
 * support lands as a new file, not a same-file expansion of the module the
 * scoring kernel already lives in. Deliberately dependency-free: both
 * `crap-engine.js` (which needs `methodIdentityKey` inside
 * `finalizeMethodRowsWithBaseline`) and `baselines/kinds/crap.js` (which
 * needs the file-scoped index) import FROM here, and this module imports
 * from neither — the only shape that keeps the edge one-directional.
 */

/**
 * Per-file half of the method-identity key `baselines/kinds/crap.js`'s
 * `crapRowKey` composes with the file path (`${path}::${method}@${startLine}`).
 * The path component is redundant once a row set is already narrowed to one
 * file, which is exactly what `indexBaselineRowsByFile` does below.
 *
 * @param {{method: string, startLine: number}} row
 * @returns {string}
 */
export function methodIdentityKey(row) {
  return `${row.method}@${row.startLine}`;
}

/**
 * Index baseline rows (accepts either the `{file, method, startLine, crap}`
 * legacy shape `compareCrap`/`scanAndScore` use, or the on-disk `{path, ...}`
 * shape) by file, then by `methodIdentityKey`, for O(1) per-method lookup —
 * exactly the shape `crap-engine.js#finalizeMethodRowsWithBaseline`'s
 * `baselineByKey` expects.
 *
 * @param {Array<{file?: string, path?: string, method: string, startLine: number, crap: number}>} baselineRows
 * @returns {Map<string, Map<string, {crap: number}>>} file → (method@startLine → row)
 */
export function indexBaselineRowsByFile(baselineRows) {
  const byFile = new Map();
  for (const row of baselineRows ?? []) {
    const file = row?.file ?? row?.path;
    if (typeof file !== 'string' || file.length === 0) continue;
    if (!byFile.has(file)) byFile.set(file, new Map());
    byFile.get(file).set(methodIdentityKey(row), row);
  }
  return byFile;
}
