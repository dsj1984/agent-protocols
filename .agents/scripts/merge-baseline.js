#!/usr/bin/env node

/**
 * merge-baseline.js — git merge driver for `baselines/*.json` (Story #5215).
 *
 * ## The failure it replaces
 *
 * Every baseline write stamps `generatedAt` on line 4, so two branches that
 * each refresh a baseline ALWAYS differ there — even when they moved
 * completely disjoint rows. Git merges JSON as text, so whether it can
 * separate that hunk from the moved rows is an accident of proximity:
 *
 *   - it cannot → a conflict on work that never overlapped (the observed
 *     `coverage.json` / `maintainability.json` "always conflicts" pattern);
 *   - it can → it splices both sides' row lines into a row set neither side
 *     scored, and the ratchet then guards a number no scorer produced (the
 *     observed `crap.json` "silently auto-merges" pattern).
 *
 * The quiet one is the worse one. A baseline is a set of rows keyed by
 * identity plus a rollup derived from them, so this driver merges it as
 * that — see `lib/baselines/merge-envelopes.js` for the semantics.
 *
 * ## Contract
 *
 *   node .agents/scripts/merge-baseline.js %O %A %B %P
 *
 * git's merge-driver calling convention: `%O` ancestor, `%A` ours (and the
 * file the driver MUST leave its result in), `%B` theirs, `%P` the real
 * pathname being merged. Exit 0 merged clean, non-zero conflicted.
 *
 * Registered per clone (registration is per-clone, so `mandrel doctor` is
 * the guard that it happened, not `mandrel sync`):
 *
 *   .gitattributes:  baselines/*.json merge=mandrel-baseline
 *   git config:      merge.mandrel-baseline.driver
 *
 * ## Not every `baselines/*.json` is an envelope
 *
 * That glob also matches arch-cycles, cyclomatic, dead-exports, audit-ledger,
 * context-budget and workflow-citations — files with their own shapes and no
 * row identity. Anything whose `$schema` is not a known per-kind envelope is
 * handed straight back to `git merge-file`, so registering the driver cannot
 * change their behaviour.
 */

import fs from 'node:fs';
import path from 'node:path';

import { assertEnvelope } from './lib/baselines/envelope.js';
import {
  kindFromEnvelope,
  mergeEnvelopes,
} from './lib/baselines/merge-envelopes.js';
import { writeFile as writeEnvelopeFile } from './lib/baselines/writer.js';
import { spawnChild } from './lib/child-exec.js';
import { runAsCli } from './lib/cli-utils.js';

/** Indent one row's canonical JSON to its position inside `rows`. */
function rowBlock(row) {
  return JSON.stringify(row, null, 2)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Wrap each conflicting row in git conflict markers, leaving every other row
 * merged. Operates on the canonical text the writer already produced, so the
 * non-conflicting remainder of the file is byte-identical to what a clean
 * merge would have written.
 *
 * @param {string} text Canonical serialization of the merged envelope.
 * @param {Array<object>} conflicts Row-scoped conflict records.
 * @returns {string}
 */
export function renderConflictMarkers(text, conflicts) {
  let out = text;
  for (const conflict of conflicts) {
    const placed = conflict.ours ?? conflict.theirs;
    if (placed === undefined) continue;
    const block = rowBlock(placed);
    // The row may or may not be the last element of `rows`; keep whichever
    // separator follows it on both sides so the markers wrap whole lines.
    const withComma = `${block},`;
    const [needle, suffix] = out.includes(withComma)
      ? [withComma, ',']
      : [block, ''];
    if (!out.includes(needle)) continue;
    const ourSide =
      conflict.ours === undefined
        ? ''
        : `${rowBlock(conflict.ours)}${suffix}\n`;
    const theirSide =
      conflict.theirs === undefined
        ? ''
        : `${rowBlock(conflict.theirs)}${suffix}\n`;
    out = out.replace(
      needle,
      `<<<<<<< ours\n${ourSide}=======\n${theirSide}>>>>>>> theirs`.replace(
        /\n$/,
        '',
      ),
    );
  }
  return out;
}

/** Read and parse a merge input; a missing or empty side is `null`. */
function readSide(file) {
  if (!file || !fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // present but unparseable — caller falls back to git
  }
}

/**
 * Hand the merge back to git's own text merge. Used for every
 * `baselines/*.json` that is not a known per-kind envelope, and for one that
 * is too damaged to parse — in both cases the driver must not invent a
 * result, and git's behaviour is exactly what the repo had before.
 *
 * @returns {number} git merge-file's own exit code.
 */
function delegateToGit(basePath, oursPath, theirsPath) {
  // `stdio: 'inherit'` so git's own conflict reporting reaches the operator
  // exactly as it would have with no driver registered. `spawnChild` returns
  // the RAW result deliberately: a `status` of null means the child was
  // killed, and that must never be read as a clean merge.
  const result = spawnChild(
    'git',
    ['merge-file', oursPath, basePath, theirsPath],
    { stdio: 'inherit' },
  );
  if (result.error) {
    process.stderr.write(
      `merge-baseline: could not run git merge-file: ${result.error.message}\n`,
    );
    return 1;
  }
  return result.status ?? 1;
}

/**
 * @param {string[]} argv Positional arguments: %O %A %B [%P].
 * @returns {number} Process exit code.
 */
export function runMergeBaseline(argv) {
  const [baseArg, oursArg, theirsArg, mergedPath] = argv;
  if (!baseArg || !oursArg || !theirsArg) {
    process.stderr.write(
      'merge-baseline: expected the git merge-driver arguments %O %A %B %P\n',
    );
    return 2;
  }

  // Git hands the driver temp filenames RELATIVE to the worktree root it
  // invokes us from (`.merge_file_xxxxxx`), so every path is resolved before
  // use — the shared writer refuses a relative path, and that refusal only
  // shows up under a real `git merge`, never when the driver is called
  // directly with absolute paths.
  const [basePath, oursPath, theirsPath] = [baseArg, oursArg, theirsArg].map(
    (p) => path.resolve(p),
  );

  const ours = readSide(oursPath);
  const theirs = readSide(theirsPath);
  const base = readSide(basePath);

  const kind = kindFromEnvelope(ours) ?? kindFromEnvelope(theirs);
  if (!kind || ours === undefined || theirs === undefined) {
    return delegateToGit(basePath, oursPath, theirsPath);
  }

  let merged;
  try {
    merged = mergeEnvelopes({ base, ours, theirs, kind });
  } catch (err) {
    process.stderr.write(`merge-baseline: ${kind}: ${err.message}\n`);
    return delegateToGit(basePath, oursPath, theirsPath);
  }

  const rowConflicts = merged.conflicts.filter((c) => c.scope === 'row');
  const envelopeConflicts = merged.conflicts.filter(
    (c) => c.scope === 'envelope',
  );

  // Write the canonical projection first even when conflicted: the marker
  // rendering operates on exactly the bytes a clean merge would have left,
  // so the merged remainder of a conflicted file is identical to it.
  writeEnvelopeFile(oursPath, merged.envelope);

  if (merged.conflicts.length === 0) {
    assertEnvelope(merged.envelope);
    return 0;
  }

  const label = mergedPath || oursPath;
  for (const conflict of envelopeConflicts) {
    process.stderr.write(
      `merge-baseline: conflict ${kind} envelope key "${conflict.identity}" in ${label} — ours ${JSON.stringify(conflict.ours)}, theirs ${JSON.stringify(conflict.theirs)}\n`,
    );
  }
  for (const conflict of rowConflicts) {
    process.stderr.write(
      `merge-baseline: conflict ${kind} row "${conflict.identity}" in ${label}\n`,
    );
  }

  if (rowConflicts.length > 0) {
    const text = fs.readFileSync(oursPath, 'utf8');
    fs.writeFileSync(oursPath, renderConflictMarkers(text, rowConflicts));
  }
  return 1;
}

function main() {
  return runMergeBaseline(process.argv.slice(2));
}

runAsCli(import.meta.url, main, {
  source: 'merge-baseline',
  propagateExitCode: true,
  usage: {
    invocation: 'node .agents/scripts/merge-baseline.js %O %A %B %P',
    summary:
      'Git merge driver for baselines/*.json. Merges per-kind envelopes by ROW IDENTITY — disjoint refreshes merge clean, the rollup is recomputed from the merged rows, and generatedAt resolves to the later stamp instead of conflicting. A baselines file that is not a known per-kind envelope is handed back to git merge-file unchanged. Exit 0 clean, 1 conflicted.',
    flags: [
      ['%O', 'Merge ancestor (git supplies this).'],
      ['%A', 'Our version — the driver writes its result here.'],
      ['%B', 'Their version.'],
      ['%P', 'Real pathname being merged; used in conflict messages.'],
    ],
  },
});
