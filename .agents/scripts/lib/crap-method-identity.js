/**
 * crap-method-identity.js — order-independent identity for the methods an
 * escomplex report describes (Story #4969).
 *
 * Split out of `crap-engine.js` deliberately. That module is the CRAP scoring
 * kernel — parse, remap a line, join coverage, apply the formula — and naming
 * a method is a different question from scoring one: it reads the shape of the
 * scope tree and nothing about coverage or complexity. Keeping the walker here
 * leaves the kernel's contract ("pure, no I/O, one method in, one score out")
 * legible instead of half-buried under a tree traversal.
 */

/**
 * The label `typhonjs-escomplex-commons` gives a function it cannot name
 * (Story #4969).
 *
 * The `N` is a per-module counter incremented during the AST walk, so it
 * numbers a function by its *position among its anonymous siblings* rather
 * than by anything about the function itself. Inserting or deleting one
 * anonymous function renumbers every later one in the file — and 34.6% of this
 * repository's CRAP rows were keyed on exactly that. See
 * `deriveMethodIdentities` for what replaces it.
 */
const ESCOMPLEX_ANON_LABEL_RE = /^<anon method-\d+>$/;

/**
 * True for a `method` value that is a derived anonymous identity rather than a
 * name the source actually carries — either this module's `<anon …>` identity
 * or escomplex's superseded ordinal label.
 *
 * @param {unknown} method
 * @returns {boolean}
 */
export function isAnonymousMethodLabel(method) {
  return typeof method === 'string' && method.startsWith('<anon ');
}

/**
 * Coerce a method's escomplex line span into a usable numeric pair. A method
 * missing either bound still has to take a deterministic place in the scope
 * tree, so it collapses to a zero-width span rather than being dropped: an
 * identity that varies with how the parser failed would be worse than one that
 * is merely coarse.
 *
 * @param {{lineStart?: unknown, lineEnd?: unknown}} m
 * @returns {{lineStart: number, lineEnd: number}}
 */
function spanOf(m) {
  const lineStart = Number.isFinite(m?.lineStart) ? m.lineStart : 0;
  const lineEnd = Number.isFinite(m?.lineEnd) ? m.lineEnd : lineStart;
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

/**
 * Give every method in an escomplex report an identity that does not depend on
 * how many anonymous functions happen to precede it (Story #4969).
 *
 * **Named methods are untouched** — their identity is the name escomplex
 * reported, exactly as before, so no named row is re-keyed by this change.
 *
 * **An anonymous method is identified by where it sits, not by when it was
 * counted.** The identity is `<anon {scope path}>`, where the path is the
 * chain of enclosing methods from the module down to the method itself. Each
 * link contributes a name if it has one, otherwise its parameter list plus an
 * ordinal among the siblings that share *that exact parent and that exact
 * parameter list*:
 *
 * ```text
 *   <anon (p)#0>                                        module-scope, first (p) arrow
 *   <anon buildDefaultCrapScorer/(files,opts)#0>        inside a named function
 *   <anon buildDefaultCrapScorer/(files,opts)#0/(r)#0>  inside that one
 * ```
 *
 * **Why the parameter list and not the body.** The identity has to survive an
 * edit *to* the method — a method that gains a branch must still be recognised
 * as the same method, or a genuine complexity regression would read as a brand
 * new function and score against the new-method ceiling instead of its own
 * baseline. That rules out anything derived from the body: a source or
 * normalized-AST hash re-keys the row on the very edit the gate exists to
 * catch. A parameter list is stable across the edits CRAP measures, and it
 * partitions same-scope siblings finely enough that the residual ordinal is
 * almost always `#0`.
 *
 * **The residual.** Within one parent *and* one parameter list, siblings are
 * still told apart by source order, so inserting a same-signature sibling
 * *before* an existing one still shifts it. That residual is irreducible:
 * anything that distinguishes two same-scope, same-signature functions has to
 * read their bodies, and reading their bodies re-keys them on every edit. The
 * blast radius drops from "every anonymous function in the file" to "the
 * same-signature siblings of one scope".
 *
 * Emission order is load-bearing and guaranteed: escomplex walks the AST
 * pre-order, so a method's ancestors are always emitted before it. That lets a
 * single forward pass with an open-ancestor stack resolve every parent in
 * O(n), and it makes the innermost enclosing method the most recent one still
 * open.
 *
 * @param {Array<object>} methods `report.methods` from escomplex.
 * @returns {Array<{method: string, anonymous: boolean}>} One entry per input
 *   method, index-aligned with `methods` and spreadable straight onto a row.
 *   The scope path itself stays internal — only the identity leaves.
 */
export function deriveMethodIdentities(methods) {
  const identities = [];
  /** @type {Array<{lineEnd: number, scopePath: string}>} */
  const openAncestors = [];
  /** Sibling counts keyed by `parent scope path` + `parameter list`. */
  const ordinals = new Map();

  for (const m of methods ?? []) {
    const { lineStart, lineEnd } = spanOf(m);
    // Close every ancestor whose span has ended before this method begins.
    while (
      openAncestors.length > 0 &&
      openAncestors[openAncestors.length - 1].lineEnd < lineStart
    ) {
      openAncestors.pop();
    }
    const parentPath =
      openAncestors.length > 0
        ? openAncestors[openAncestors.length - 1].scopePath
        : '';

    const name = typeof m?.name === 'string' ? m.name : '';
    let segment;
    let anonymous;
    if (name === '' || ESCOMPLEX_ANON_LABEL_RE.test(name)) {
      const params = Array.isArray(m?.paramNames) ? m.paramNames : [];
      const signature = `(${params.join(',')})`;
      // NUL separates the two halves because it is the one character a scope
      // path can never contain — a printable delimiter could be produced by a
      // parameter name and silently merge two distinct buckets. Spelled as an
      // escape: a literal NUL byte would make this file binary to git and grep.
      const bucket = `${parentPath}\u0000${signature}`;
      const ordinal = ordinals.get(bucket) ?? 0;
      ordinals.set(bucket, ordinal + 1);
      segment = `${signature}#${ordinal}`;
      anonymous = true;
    } else {
      segment = name;
      anonymous = false;
    }

    const scopePath = parentPath === '' ? segment : `${parentPath}/${segment}`;
    identities.push({
      method: anonymous ? `<anon ${scopePath}>` : name,
      anonymous,
    });
    openAncestors.push({ lineEnd, scopePath });
  }

  return identities;
}
