/**
 * Step registrars for the gherkin-corpus fixtures.
 *
 * The fixture step files are never executed — `check-gherkin-corpus.js` reads
 * them as source text. They import from here anyway so each one is a valid ES
 * module that passes the repository's own lint, which is also what a real
 * step-definition file looks like.
 */

const noop = () => {};

export const Given = noop;
export const When = noop;
export const Then = noop;
