/**
 * conventional-subject.js — the pure Conventional-Commit rules behind the
 * squash-merge subject a standalone Story lands on `main`.
 *
 * Split out of `normalize-pr-title.js` so the rules that decide
 * what the release notes say are testable without a git read. The three rules
 * here each closed a defect observed live on `main`:
 *
 *   1. **Type precedence follows release impact.** A multi-commit Story used
 *      to resolve its type off a hand-ordered list in which `docs` outranked
 *      `chore` for no stated reason. Story #5004 (`chore(gates)`, `docs(ci)`,
 *      `chore(baselines)`) therefore landed as
 *      `docs: check/CI gate sweep …` — a change that deleted five
 *      `lib/checks` modules, two CLIs and a dependency, filed under
 *      documentation. `TYPE_RANK` now mirrors `changelog-sections` in
 *      `release-please-config.json`: rank IS how visible the type is in the
 *      release notes. Types that render identically (the six `hidden: true`
 *      ones) share a rank, because there is no honest ordering between them —
 *      those ties break on how much of the branch carries the type, then on
 *      the Story's primary (oldest) commit.
 *
 *   2. **Casing leaves acronyms alone.** The old synthesizer lowercased the
 *      first character unconditionally to satisfy commitlint's `subject-case`
 *      rule, which turned Story #5002's "CRAP surface diet" into
 *      `refactor: cRAP surface diet`. `shapeDescription` lowercases only when
 *      the leading word is not an all-caps token, so CRAP / CI / QA / API
 *      survive. That is a deliberate, narrow trade: commitlint's
 *      `subject-case` treats ANY leading capital as sentence-case and would
 *      flag `CRAP surface diet` — but commitlint never runs on a PR title or
 *      a GitHub squash subject (see `rules/git-conventions.md` §
 *      Conventional Commits), so the rule it would fail is not a gate this
 *      subject passes through, while a mangled acronym is permanent in the
 *      changelog.
 *
 *   3. **A breaking change survives the squash.** release-please only sees a
 *      breaking change through a `!` in the subject or a `BREAKING CHANGE:`
 *      footer. Story #5004 removed `project.commands.lintBaseline` from a
 *      schema block that is `additionalProperties: false` — a hard consumer
 *      break — described in prose in the commit body and therefore invisible
 *      to the parser. `collectBreakingNotes` reads the footer out of any
 *      constituent commit (or a Story-body declaration) and `markBreaking`
 *      puts the `!` where the parser looks.
 */

/**
 * The Conventional-Commit types Mandrel accepts. Mirrors
 * `commitlint.config.js` → `type-enum` and `release-please-config.json` →
 * `changelog-sections`. Kept in sync by hand (single hard-cutover, no
 * shim) — adding a type means touching all three.
 */
const CONVENTIONAL_TYPES = Object.freeze([
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'docs',
  'style',
  'chore',
  'test',
  'build',
  'ci',
]);

/**
 * Release-impact rank per type — LOWER wins. Derived from
 * `changelog-sections` in `release-please-config.json`: the five types that
 * render a visible section are ordered by how much a reader needs to see
 * them, and the six `hidden: true` types share the bottom rank because the
 * release notes draw no distinction between them.
 *
 * @type {Readonly<Record<string, number>>}
 */
const TYPE_RANK = Object.freeze({
  feat: 0, // "Added"
  fix: 1, // "Fixed"
  perf: 2, // "Performance"
  revert: 3, // "Reverted"
  refactor: 4, // "Changed"
  docs: 5, // hidden
  style: 5, // hidden
  chore: 5, // hidden
  test: 5, // hidden
  build: 5, // hidden
  ci: 5, // hidden
});

/** Rank for a type absent from `TYPE_RANK` — always loses. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

const TYPE_GROUP = CONVENTIONAL_TYPES.join('|');

// Anchored Conventional-Commit header matcher:
//   <type>(<optional scope>)<optional !>: <non-empty description>
// Mirrors the shape `@commitlint/config-conventional` enforces (a known
// type, an optional parenthesised scope, an optional breaking `!`, a
// colon-space separator, and a non-empty subject). Used for the pure
// "is this already conventional?" check and to pull the type off a branch
// commit subject without spawning commitlint per call.
const CONVENTIONAL_HEADER_RE = new RegExp(
  `^(?:${TYPE_GROUP})(?:\\([^()\\r\\n]+\\))?!?: \\S.*$`,
);
const LEADING_TYPE_RE = new RegExp(
  `^(${TYPE_GROUP})(?:\\([^()\\r\\n]+\\))?(!?):`,
);
// Splits a conventional header into `<type><scope?>`, `<!?>`, `<description>`
// so the breaking marker can be inserted at the one position the parser reads.
const HEADER_PARTS_RE = new RegExp(
  `^((?:${TYPE_GROUP})(?:\\([^()\\r\\n]+\\))?)(!?): (.*)$`,
);

/**
 * The Conventional-Commits breaking footer, in both spellings the spec
 * defines (`BREAKING CHANGE:` and the hyphenated `BREAKING-CHANGE:`). Case is
 * significant — the spec requires uppercase, and so does
 * `conventional-commits-parser`'s default `noteKeywords`, so matching
 * case-insensitively here would announce breaks release-please will not.
 */
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:[ \t]*(.*)$/;

/** A git-trailer-shaped line (`Some-Token: value`) — ends a footer's text. */
const TRAILER_RE = /^[A-Za-z][A-Za-z-]*:[ \t]/;
/** An opening or closing markdown code fence: ``` or ~~~, optionally indented. */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * True iff `subject` is a parseable Conventional Commit subject under the
 * repo's type vocabulary. Pure.
 *
 * @param {string} subject
 * @returns {boolean}
 */
export function isConventionalSubject(subject) {
  if (typeof subject !== 'string') return false;
  return CONVENTIONAL_HEADER_RE.test(subject.trim());
}

/**
 * Extract the Conventional-Commit `type` from a single commit subject, or
 * `null` when the subject is not conventional. Pure.
 *
 * @param {string} subject
 * @returns {string|null}
 */
function parseConventionalType(subject) {
  if (typeof subject !== 'string') return null;
  const match = subject.trim().match(LEADING_TYPE_RE);
  return match ? match[1] : null;
}

/**
 * Order two type candidates: release impact first, then how much of the
 * branch carries the type, then the earliest commit that used it. The second
 * and third keys only ever decide a tie inside the hidden tier — every
 * visible type holds its rank alone.
 *
 * @param {{rank: number, count: number, firstIndex: number}} a
 * @param {{rank: number, count: number, firstIndex: number}} b
 * @returns {number}
 */
function compareTypeCandidates(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.count !== b.count) return b.count - a.count;
  return a.firstIndex - b.firstIndex;
}

/**
 * Pick the type the squash subject should carry from the branch's own commit
 * subjects. Returns `null` when no subject is conventional.
 *
 * `subjects` MUST be oldest-first: the final tie-break reads index 0 as the
 * Story's primary commit, the one whose type the operator chose before any
 * fixup or baseline-refresh commit piled on.
 *
 * @param {string[]} subjects Commit subjects, oldest first.
 * @returns {string|null}
 */
export function pickDominantType(subjects) {
  /** @type {Map<string, {type: string, rank: number, count: number, firstIndex: number}>} */
  const candidates = new Map();
  const list = Array.isArray(subjects) ? subjects : [];
  list.forEach((subject, index) => {
    const type = parseConventionalType(subject);
    if (!type) return;
    const seen = candidates.get(type);
    if (seen) {
      seen.count += 1;
      return;
    }
    candidates.set(type, {
      type,
      rank: TYPE_RANK[type] ?? UNRANKED,
      count: 1,
      firstIndex: index,
    });
  });
  if (candidates.size === 0) return null;
  return [...candidates.values()].sort(compareTypeCandidates)[0].type;
}

/**
 * True when the leading word of `text` is an all-caps token — an acronym the
 * synthesizer must not touch. Requires two or more letters so a stray leading
 * "A" or "I" still lowercases; punctuation and digits are ignored so
 * `CRAP:`, `CI/CD` and `API-surface` all read as acronyms while `A11y` does
 * not.
 *
 * @param {string} text
 * @returns {boolean}
 */
function leadsWithAcronym(text) {
  const [word = ''] = text.split(/\s+/, 1);
  const letters = word.replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 && letters === letters.toUpperCase();
}

/**
 * Shape a human Story title into the description half of a synthesized
 * Conventional-Commit subject: lowercase the first character so the subject
 * reads as a sentence fragment, EXCEPT when the leading word is an acronym.
 * Pure.
 *
 * @param {string} text
 * @returns {string}
 */
export function shapeDescription(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length === 0) return trimmed;
  if (leadsWithAcronym(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Insert the breaking-change `!` into a conventional subject, at the one
 * position `conventional-commits-parser` reads it: immediately before the
 * colon, after any scope. A subject that already carries `!`, or that is not
 * conventional, is returned unchanged. Pure.
 *
 * @param {string} subject
 * @returns {string}
 */
export function markBreaking(subject) {
  const parts = String(subject ?? '').match(HEADER_PARTS_RE);
  if (!parts) return subject;
  const [, prefix, bang, description] = parts;
  if (bang === '!') return subject;
  return `${prefix}!: ${description}`;
}

/**
 * Pull the text of one `BREAKING CHANGE:` footer out of `lines`, starting at
 * the footer line itself. The note runs to the end of its paragraph: a blank
 * line, another trailer, or the end of the message closes it.
 *
 * @param {string[]} lines
 * @param {number} start Index of the matched footer line.
 * @param {string} head The footer line's own text (may be empty).
 * @returns {{ note: string, next: number }}
 */
function readFooterNote(lines, start, head) {
  const collected = head.trim().length > 0 ? [head.trim()] : [];
  let cursor = start + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim().length === 0) break;
    if (BREAKING_FOOTER_RE.test(line) || TRAILER_RE.test(line)) break;
    collected.push(line.trim());
    cursor += 1;
  }
  return { note: collected.join(' ').trim(), next: cursor };
}

/**
 * Scan one commit message (or the Story body) for breaking-change evidence.
 *
 * @param {string} text
 * @param {boolean} readHeaderBang Whether line 0 is a commit header whose `!`
 *   counts. False for the Story body, which has no header.
 * @returns {{ breaking: boolean, notes: string[], subject: string|null }}
 */
/**
 * Blank every line inside a markdown code fence, keeping line indices intact.
 *
 * A Story `## Spec` that documents this very contract quotes the footer in a
 * fence; reading that as a declaration ships a `<type>!:` subject and a release
 * note for a break nobody made. Fenced spans are the only place the anchored
 * footer regex can fire on non-footer text — an indented block or a blockquote
 * already fails the `^` anchor. Blanking rather than dropping means a fence
 * also closes an open footer note, which is what a paragraph break would do.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function blankFencedLines(lines) {
  let fence = null;
  return lines.map((line) => {
    const marker = line.match(FENCE_RE)?.[1][0];
    if (!marker) return fence === null ? line : '';
    if (fence === null) fence = marker;
    else if (fence === marker) fence = null;
    return '';
  });
}

function scanForBreaking(text, readHeaderBang) {
  const lines = blankFencedLines(String(text ?? '').split('\n'));
  const notes = [];
  let breaking = false;
  let subject = null;

  if (readHeaderBang) {
    const header = lines[0]?.trim() ?? '';
    const parts = header.match(HEADER_PARTS_RE);
    if (parts?.[2] === '!') {
      breaking = true;
      subject = parts[3].trim();
    }
  }

  let cursor = 0;
  while (cursor < lines.length) {
    const match = lines[cursor].match(BREAKING_FOOTER_RE);
    if (!match) {
      cursor += 1;
      continue;
    }
    breaking = true;
    const { note, next } = readFooterNote(lines, cursor, match[1]);
    if (note.length > 0) notes.push(note);
    cursor = Math.max(next, cursor + 1);
  }

  return { breaking, notes, subject };
}

/**
 * Collect the branch's breaking-change declarations.
 *
 * Two sources, both honoured:
 *
 *   - **Any constituent commit** — a `BREAKING CHANGE:` / `BREAKING-CHANGE:`
 *     footer, or a `!` in the header. This is the path a maker takes while
 *     writing the commit that does the breaking.
 *   - **The Story body** — the same footer, written as its own line anywhere
 *     in the Story issue (the `## Spec` block is the natural home). This is
 *     the declarative path: `/mandrel-plan` can state the break up front and close
 *     propagates it even when no individual commit remembered the footer.
 *     Only the footer form counts; prose describing a break does not, because
 *     a keyword-free sentence is exactly what release-please cannot parse.
 *
 * When something is breaking but no footer supplied text, the `!` commit's
 * own description becomes the note — the fallback Conventional Commits
 * itself prescribes for a `!` header with no footer.
 *
 * @param {{ commitMessages?: string[], storyBody?: string }} args
 * @returns {{ breaking: boolean, notes: string[] }}
 */
export function collectBreakingNotes({ commitMessages = [], storyBody = '' }) {
  const notes = [];
  let breaking = false;
  let bangSubject = null;

  for (const message of Array.isArray(commitMessages) ? commitMessages : []) {
    const scan = scanForBreaking(message, true);
    breaking = breaking || scan.breaking;
    notes.push(...scan.notes);
    bangSubject ??= scan.subject;
  }

  const bodyScan = scanForBreaking(storyBody, false);
  breaking = breaking || bodyScan.breaking;
  notes.push(...bodyScan.notes);

  if (breaking && notes.length === 0 && bangSubject) notes.push(bangSubject);
  return { breaking, notes: [...new Set(notes)] };
}
