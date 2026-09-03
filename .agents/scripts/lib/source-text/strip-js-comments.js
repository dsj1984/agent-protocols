// .agents/scripts/lib/source-text/strip-js-comments.js
/**
 * The one string-literal-aware JavaScript comment stripper.
 *
 * Several guards in this repository grep source text for a pattern that must
 * appear in real code rather than in a docblock — a CLI citation, an import
 * specifier, a schema path. Each grew its own stripper, and the four
 * implementations disagreed on what a stripped block comment leaves behind:
 * one preserved newlines only, one deleted the comment outright (losing line
 * numbers), one blanked it to whitespace, and one used a regex that did not
 * honour string literals at all. A fix to any of them silently missed the
 * others, and a guard whose own rationale mentions the pattern it greps for
 * can satisfy itself if the stripping is wrong.
 *
 * **Semantics: comment bodies become equivalent whitespace.** Every character
 * of a comment is replaced by a space except newlines, which survive. That is
 * the most information-preserving of the four behaviours and the only one that
 * is safe for all of them:
 *
 *   - line and column positions are unchanged, so a guard can report a
 *     `file:line` that matches the original source;
 *   - a regex looking for code cannot match comment text, because none
 *     survives;
 *   - the output is the same length as the input, so byte offsets hold.
 *
 * String and template literals are copied through verbatim, so a `//` inside a
 * URL or a `/*` inside a message is not mistaken for a comment opener. Escape
 * sequences are honoured, so an escaped quote does not end the literal early.
 *
 * An unterminated comment or literal runs to end of input rather than
 * throwing: this is a lint helper reading files that may be mid-edit, and a
 * crash there would be a worse failure than a slightly over-stripped tail.
 *
 * Builtins only — no dependency, so the guards that run before a consumer's
 * install can use it.
 */

/**
 * Replace every non-newline character of `text` with a space.
 *
 * @param {string} text
 * @returns {string}
 */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Index just past the string or template literal opening at `start`.
 * Runs to end of input when the literal is never closed.
 *
 * @param {string} text
 * @param {number} start - index of the opening quote
 * @returns {number}
 */
function endOfLiteral(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * Strip JavaScript comments, replacing their bodies with equivalent
 * whitespace so line numbers, columns and byte offsets all survive.
 *
 * @param {string} source - JavaScript source text. Nullish is treated as empty.
 * @returns {string} the source with every comment body blanked to whitespace
 */
export function stripJsComments(source) {
  const text = String(source ?? '');
  let out = '';
  let i = 0;

  while (i < text.length) {
    const two = text.slice(i, i + 2);

    if (two === '//') {
      const newline = text.indexOf('\n', i);
      const stop = newline === -1 ? text.length : newline;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }

    if (two === '/*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? text.length : close + 2;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }

    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const stop = endOfLiteral(text, i);
      out += text.slice(i, stop);
      i = stop;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
