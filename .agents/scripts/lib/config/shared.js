/**
 * Cross-block helpers for the lib/config/* sub-modules (Epic #773 Story 6).
 *
 * Lives outside the per-sub-block files because more than one resolver needs
 * the same merge primitives. Adding a helper here is appropriate when ≥ 2
 * sub-block resolvers would otherwise duplicate the same logic; keep
 * single-use helpers private to their own sub-block.
 */

/**
 * Deep-merge a list-valued config key with its framework default.
 *
 * Accepts:
 *   - `undefined`           → return a copy of `defaultList`
 *   - plain array           → replace wholesale (returns a copy)
 *   - `{ append, prepend }` → extend `defaultList`; items already present in
 *                             the result are deduped so a consumer appending
 *                             a framework entry does not produce a duplicate.
 *
 * @param {readonly string[]} defaultList
 * @param {unknown} userValue
 * @returns {string[]}
 */
export function resolveListValue(defaultList, userValue) {
  if (userValue === undefined) return [...defaultList];
  if (Array.isArray(userValue)) return [...userValue];
  if (userValue !== null && typeof userValue === 'object') {
    const result = [];
    const seen = new Set();
    const push = (item) => {
      if (!seen.has(item)) {
        result.push(item);
        seen.add(item);
      }
    };
    if (Array.isArray(userValue.prepend)) {
      for (const item of userValue.prepend) push(item);
    }
    for (const item of defaultList) push(item);
    if (Array.isArray(userValue.append)) {
      for (const item of userValue.append) push(item);
    }
    return result;
  }
  return [...defaultList];
}
