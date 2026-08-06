/**
 * normalize-pr-title.js — guarantee the standalone-Story PR title is a
 * valid Conventional Commit subject so the squash-merge subject on `main`
 * parses for release-please.
 *
 * Story #3969 (framework gap). The repo squash-merges, and GitHub uses the
 * PR title as the squash-commit subject. `buildPullRequest` previously
 * emitted the raw human issue title (`<storyTitle> (#<id>)`), which is a
 * plain description ("Rename the published npm package…") that
 * release-please's Conventional-Commit parser rejects:
 *
 *   ❯ commit could not be parsed: … Rename the published npm package …
 *   ❯ error: unexpected token ' ' at 1:7, valid tokens [(, !, :]
 *   ❯ commits: 0  → no release cut
 *
 * The `commit-msg` commitlint Husky hook only validates *local* commits and
 * never runs on a GitHub-UI squash-merge title, so nothing mechanized the
 * documented "author the PR title in conventional form" contract. This
 * module mechanizes it.
 *
 * Contract (pure where possible — the only side effect is an injectable
 * `git log` read):
 *
 *   - If `storyTitle` is **already** a parseable Conventional Commit
 *     subject, it is preserved verbatim and suffixed with `(#<storyId>)`.
 *     No re-prefixing, no double type.
 *   - Otherwise the title is **synthesized** into conventional form:
 *     `<type>: <descriptive text> (#<storyId>)`. The `type` is derived
 *     from the branch's own (already-conventional) commit subjects when
 *     available, falling back to a safe configured default (`chore`).
 *   - Either way, a branch (or Story) that declares a breaking change gets
 *     the `!` marker and a `BREAKING CHANGE:` footer on the PR body.
 *
 * The rules that decide *what* the subject says now live in
 * `conventional-subject.js` — type precedence, acronym-safe casing, and
 * breaking-change collection are pure and unit-tested there. What is left
 * here is the git read those rules consume and the assembly of the two
 * strings `gh pr create` needs.
 */

import { gitSpawn as defaultGitSpawn } from '../../../git-utils.js';
import { Logger as DefaultLogger } from '../../../Logger.js';
import {
  collectBreakingNotes,
  isConventionalSubject,
  markBreaking,
  pickDominantType,
  shapeDescription,
} from './conventional-subject.js';

/** Safe default Conventional-Commit type when none can be derived. */
const DEFAULT_CONVENTIONAL_TYPE = 'chore';

/**
 * Record separator between whole commit messages in the `git log` read. A NUL
 * cannot occur inside a commit message, so splitting on it is unambiguous —
 * unlike a blank-line or subject-prefix heuristic, which a commit body can
 * forge.
 */
const RECORD_SEP = '\u0000';

/**
 * Read the branch's own commits (those unique to the Story branch relative to
 * the base branch) as whole messages — subject AND body, because the body is
 * where a `BREAKING CHANGE:` footer lives.
 *
 * Returns `[]` when the read fails, which degrades every downstream rule to
 * its safe default (type `chore`, no breaking marker) rather than throwing a
 * close that is otherwise healthy.
 *
 * Oldest-first (`--reverse`) is load-bearing: `pickDominantType` breaks a tie
 * on the Story's primary commit, which is the first one authored.
 *
 * @param {{
 *   storyBranch: string,
 *   baseBranch: string,
 *   cwd?: string,
 *   gitSpawn?: typeof defaultGitSpawn,
 *   logger?: { warn?: Function },
 * }} args
 * @returns {string[]} Whole commit messages, oldest first.
 */
function readBranchCommits({
  storyBranch,
  baseBranch,
  cwd = process.cwd(),
  gitSpawn = defaultGitSpawn,
  logger = DefaultLogger,
}) {
  if (!storyBranch || !baseBranch) return [];
  const range = `${baseBranch}..${storyBranch}`;
  try {
    const result = gitSpawn(
      cwd,
      'log',
      '--no-merges',
      '--reverse',
      '--format=%B%x00',
      range,
    );
    if (result?.status !== 0) {
      logger?.warn?.(
        `[normalize-pr-title] git log ${range} failed (status=${result?.status ?? 'n/a'}); ` +
          `defaulting type to "${DEFAULT_CONVENTIONAL_TYPE}" and assuming no breaking change.`,
      );
      return [];
    }
    return String(result.stdout ?? '')
      .split(RECORD_SEP)
      .map((message) => message.trim())
      .filter((message) => message.length > 0);
  } catch (err) {
    logger?.warn?.(
      `[normalize-pr-title] could not read branch commits ` +
        `(defaulting to "${DEFAULT_CONVENTIONAL_TYPE}", no breaking change): ${err?.message ?? err}`,
    );
    return [];
  }
}

/**
 * Produce the PR title and the breaking-change notes that belong with it.
 *
 *   - Already-conventional `storyTitle` → preserved verbatim + `(#<id>)`.
 *   - Otherwise → `<derivedType>: <shaped storyTitle> (#<id>)`.
 *   - Empty / missing `storyTitle` → `<derivedType>: story #<id>`.
 *   - Breaking → `!` inserted before the colon in either shape.
 *
 * `commitMessages` is the branch read (`readBranchCommits`); passing `[]`
 * yields the safe default type and no breaking marker. `storyBody` is the
 * Story issue's body, scanned for a declared `BREAKING CHANGE:` footer.
 *
 * @param {{
 *   storyTitle: string,
 *   storyId: number|string,
 *   commitMessages?: string[],
 *   storyBody?: string,
 * }} args
 * @returns {{ title: string, breaking: boolean, breakingNotes: string[] }}
 */
function normalizePrTitle({
  storyTitle,
  storyId,
  commitMessages = [],
  storyBody = '',
}) {
  const idSuffix = `(#${storyId})`;
  const trimmed = typeof storyTitle === 'string' ? storyTitle.trim() : '';
  const { breaking, notes } = collectBreakingNotes({
    commitMessages,
    storyBody,
  });

  // Already conventional → preserve verbatim (the maker's own casing and
  // scope survive), append the id reference. Only the breaking marker may be
  // added, and only when it is not already there.
  const subject = isConventionalSubject(trimmed)
    ? trimmed
    : synthesizeSubject({ description: trimmed, storyId, commitMessages });

  const marked = breaking ? markBreaking(subject) : subject;
  return { title: `${marked} ${idSuffix}`, breaking, breakingNotes: notes };
}

/**
 * Build a conventional subject for a Story whose title is plain prose.
 *
 * @param {{ description: string, storyId: number|string, commitMessages: string[] }} args
 * @returns {string}
 */
function synthesizeSubject({ description, storyId, commitMessages }) {
  const subjects = commitMessages.map((message) => message.split('\n')[0]);
  const type = pickDominantType(subjects) ?? DEFAULT_CONVENTIONAL_TYPE;
  const raw = description.length > 0 ? description : `Story #${storyId}`;
  return `${type}: ${shapeDescription(raw)}`;
}

/**
 * Build the PR body.
 *
 * The `Closes #<id>` footer is what auto-closes the Story on merge. A
 * `BREAKING CHANGE:` footer goes LAST, as the spec requires, so that a repo
 * configured to use the PR body as the squash-commit message hands
 * release-please a parseable note rather than prose. When the squash body is
 * built from the constituent commit messages instead (GitHub's default, and
 * this repo's setting), the note still reaches `main` through whichever
 * commit carried the footer — and the `!` in the subject carries the signal
 * either way.
 *
 * @param {{ storyId: number|string, breakingNotes?: string[] }} args
 * @returns {string}
 */
function buildPrBody({ storyId, breakingNotes }) {
  const lines = [`Closes #${storyId}`, '', '_Auto-opened by `/deliver`._'];
  if (breakingNotes.length > 0) {
    lines.push('', `BREAKING CHANGE: ${breakingNotes.join(' ')}`);
  }
  return lines.join('\n');
}

/**
 * Derive the two strings `gh pr create` needs. One `git log` read serves both
 * halves: the commit SUBJECTS decide the type, and the commit BODIES — plus
 * the Story body — decide whether this is a breaking change.
 *
 * A declared break is announced on the progress channel, because a `!` the
 * operator did not expect in the squash subject should be visible while the
 * close is running rather than discovered in the release notes.
 *
 * @param {{ storyTitle: string, storyId: number|string, storyBody?: string,
 *   storyBranch: string, baseBranch: string, cwd?: string,
 *   gitSpawn?: typeof defaultGitSpawn,
 *   progress?: (tag: string, msg: string) => void }} args
 * @returns {{ title: string, body: string, breaking: boolean, breakingNotes: string[] }}
 */
export function buildPullRequestFields({
  storyTitle,
  storyId,
  storyBody = '',
  storyBranch,
  baseBranch,
  cwd = process.cwd(),
  gitSpawn = defaultGitSpawn,
  progress = () => {},
}) {
  const commitMessages = readBranchCommits({
    storyBranch,
    baseBranch,
    cwd,
    gitSpawn,
  });
  const { title, breaking, breakingNotes } = normalizePrTitle({
    storyTitle,
    storyId,
    commitMessages,
    storyBody,
  });
  if (breaking) {
    progress(
      'PR',
      '⚠️  Breaking change declared — the PR title carries `!` and the body a ' +
        `BREAKING CHANGE footer: ${breakingNotes.join(' ') || '(no note text)'}`,
    );
  }
  return {
    title,
    body: buildPrBody({ storyId, breakingNotes }),
    breaking,
    breakingNotes,
  };
}
