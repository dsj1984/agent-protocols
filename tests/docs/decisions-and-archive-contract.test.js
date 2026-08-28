import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Story #4786 — contract tests for the decision log and the pattern archive.
 *
 * These pin the four invariants the ADR pruning depends on:
 *
 *   1. Every entry below the ADR index carries a `**Status:**` line and a
 *      `<date>-<ticket>` identifier. Story #5077 made this the enabling
 *      invariant: the ADR predicate used to be `statusLine !== ''`, so an
 *      entry missing the very field these assertions validate was
 *      reclassified as not-an-ADR and skipped by all of them, while the index
 *      went on counting it as in force.
 *   2. An `Accepted` ADR names a `**Surface:**` path that exists on disk. An
 *      ADR is a claim about the current system; a decision cannot be in force
 *      while the file it decided is gone. Body paths are deliberately NOT
 *      checked — an ADR legitimately records what was true when written.
 *   3. Every ADR identifier in `docs/decisions.md` is unique, so a
 *      cross-reference by identifier resolves to exactly one entry.
 *   4. Every section archived out of `docs/patterns.md` leaves a pointer line
 *      behind in the live doc, so relocated history is never orphaned.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const DECISIONS = path.join(REPO_ROOT, 'docs', 'decisions.md');
const PATTERNS = path.join(REPO_ROOT, 'docs', 'patterns.md');
const ARCHIVE = path.join(REPO_ROOT, 'docs', 'archive', 'patterns-2026-07.md');

/**
 * Headings below the index block that are deliberately not ADR entries. The
 * index declares the same set under its "Not ADR entries" heading; keep the
 * two in step. Everything else below `<!-- ADR-INDEX:END -->` is an ADR and is
 * held to the full contract.
 */
const NON_ADR_HEADINGS = new Set(['Earlier ADRs (001 / 002 / 003)']);

/** Split a decision log into `## `-delimited entries. */
export function parseAdrs(source) {
  const lines = source.split('\n');
  const indexEnd = lines.findIndex((l) => l.includes('<!-- ADR-INDEX:END -->'));
  const starts = [];
  lines.forEach((line, i) => {
    if (line.startsWith('## ')) starts.push(i);
  });
  return starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const title = lines[start].slice(3).trim();
    const body = lines.slice(start, end);
    const statusLine = body.find((l) => l.includes('**Status:**')) ?? '';
    const status = statusLine.split('**Status:**')[1]?.trim() ?? '';
    const surfaceLine = body.find((l) => l.includes('**Surface:**')) ?? '';
    return {
      title,
      line: start + 1,
      status,
      surface: surfaceLine.match(/`([^`]+)`/)?.[1] ?? null,
      isAccepted: /^Accepted/i.test(status),
      hasStatus: statusLine !== '',
      // Structural, NOT `statusLine !== ''`. Keying the ADR predicate on a
      // field these tests validate makes an entry that omits it disappear
      // from the contract instead of failing it (Story #5077). A log with no
      // index block yields no ADRs at all, which the populated-log assertion
      // below turns into a failure rather than a silent pass.
      isAdr:
        indexEnd !== -1 && start > indexEnd && !NON_ADR_HEADINGS.has(title),
    };
  });
}

/** GitHub-flavoured heading slug. */
export function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/ /g, '-');
}

/** The `20260507-1114a` / `004` style identifier carried by an ADR heading. */
export function adrIdentifier(title) {
  const match = title.match(/^ADR[- ]+([\w-]+)\s*:/);
  return match ? match[1] : null;
}

test('every decision-log entry declares a Status line', () => {
  const adrs = parseAdrs(fs.readFileSync(DECISIONS, 'utf8')).filter(
    (a) => a.isAdr,
  );
  assert.ok(
    adrs.length > 20,
    `expected a populated decision log, saw ${adrs.length} entries`,
  );

  const statusless = adrs.filter((a) => !a.hasStatus);
  assert.deepEqual(
    statusless.map((a) => `${DECISIONS}:${a.line} ${a.title}`),
    [],
    'every entry below the ADR index must declare **Status:** — the log reads an unmarked entry as in force, so the absent field is the case that must fail loudly',
  );
});

test('every Accepted ADR names a Surface path that exists on disk', () => {
  const adrs = parseAdrs(fs.readFileSync(DECISIONS, 'utf8')).filter(
    (a) => a.isAdr,
  );
  assert.ok(
    adrs.length > 20,
    `expected a populated decision log, saw ${adrs.length} entries`,
  );

  const missingSurface = adrs.filter((a) => a.isAccepted && !a.surface);
  assert.deepEqual(
    missingSurface.map((a) => `${DECISIONS}:${a.line} ${a.title}`),
    [],
    'an Accepted ADR must declare **Surface:** `<path>` naming the surface it governs',
  );

  const absent = adrs
    .filter((a) => a.isAccepted)
    .filter((a) => !fs.existsSync(path.join(REPO_ROOT, a.surface)));
  assert.deepEqual(
    absent.map((a) => `${DECISIONS}:${a.line} ${a.title} -> ${a.surface}`),
    [],
    'an ADR cannot stay Accepted once its surface is gone — mark it Superseded by <ref> or Reverted (<date>) in place',
  );
});

test('every ADR identifier in docs/decisions.md is unique', () => {
  const adrs = parseAdrs(fs.readFileSync(DECISIONS, 'utf8')).filter(
    (a) => a.isAdr,
  );
  const seen = new Map();
  const duplicates = [];
  const unidentified = [];
  for (const adr of adrs) {
    const id = adrIdentifier(adr.title);
    // An entry with no identifier used to `continue` here, so "no id at all"
    // passed the identifier contract silently — and nothing could supersede
    // the entry by reference, because there was no name to cite (#5077).
    if (!id) {
      unidentified.push(`${DECISIONS}:${adr.line} ${adr.title}`);
      continue;
    }
    if (seen.has(id))
      duplicates.push(`${id}: L${seen.get(id)} and L${adr.line}`);
    else seen.set(id, adr.line);
  }
  assert.deepEqual(
    unidentified,
    [],
    'every entry must carry a `<date>-<ticket>` identifier so another entry can supersede it by reference',
  );
  assert.deepEqual(
    duplicates,
    [],
    'a cross-reference by identifier must resolve to exactly one entry',
  );
});

test('every ADR heading anchor linked from within docs/decisions.md resolves', () => {
  const source = fs.readFileSync(DECISIONS, 'utf8');
  const anchors = new Set(
    source
      .split('\n')
      .filter((l) => /^#{1,6} /.test(l))
      .map((l) => slugify(l.replace(/^#+\s*/, '').trim())),
  );
  const broken = [...source.matchAll(/\]\(#([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((a) => !anchors.has(a));
  assert.deepEqual(
    [...new Set(broken)],
    [],
    'in-document anchor links must resolve to a heading',
  );
});

test('the index lists every ADR with its current status', () => {
  const source = fs.readFileSync(DECISIONS, 'utf8');
  const start = source.indexOf('<!-- ADR-INDEX:START -->');
  const end = source.indexOf('<!-- ADR-INDEX:END -->');
  assert.ok(
    start !== -1 && end > start,
    'docs/decisions.md must carry a delimited index block',
  );
  const index = source.slice(start, end);

  const adrs = parseAdrs(source).filter((a) => a.isAdr);
  const missing = adrs.filter((a) => !index.includes(`#${slugify(a.title)}`));
  assert.deepEqual(
    missing.map((a) => a.title),
    [],
    'the status-annotated index must link every entry in the log',
  );

  // Accepted entries are listed in the in-force table, ahead of the closed one.
  const closedHeading = index.indexOf('**Closed (');
  assert.ok(
    closedHeading !== -1,
    'the index must separate in-force entries from closed ones',
  );
  for (const adr of adrs.filter((a) => a.isAccepted)) {
    const at = index.indexOf(`#${slugify(adr.title)}`);
    assert.ok(
      at < closedHeading,
      `Accepted ADR listed under Closed: ${adr.title}`,
    );
  }
});

test('every archived pattern section has a pointer line in docs/patterns.md', () => {
  const archive = fs.readFileSync(ARCHIVE, 'utf8');
  const live = fs.readFileSync(PATTERNS, 'utf8');

  const sections = archive
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());
  assert.ok(
    sections.length >= 5,
    `expected the archived sections, saw ${sections.length}`,
  );

  const orphaned = sections.filter(
    (heading) =>
      !live.includes(
        `[${heading}](archive/patterns-2026-07.md#${slugify(heading)})`,
      ),
  );
  assert.deepEqual(
    orphaned,
    [],
    'relocated history must leave a pointer line behind in the live doc',
  );

  // And the pointers must resolve to a real heading in the archive.
  const archiveAnchors = new Set(sections.map(slugify));
  const broken = [...live.matchAll(/archive\/patterns-2026-07\.md#([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((a) => !archiveAnchors.has(a));
  assert.deepEqual(
    [...new Set(broken)],
    [],
    'archive pointers must resolve to an archived section',
  );
});

test('no archived pattern section is left duplicated in the live doc', () => {
  const archive = fs.readFileSync(ARCHIVE, 'utf8');
  const live = fs.readFileSync(PATTERNS, 'utf8');
  const liveHeadings = new Set(
    live
      .split('\n')
      .filter((l) => l.startsWith('## '))
      .map((l) => l.slice(3).trim()),
  );
  const duplicated = archive
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim())
    .filter((h) => liveHeadings.has(h));
  assert.deepEqual(
    duplicated,
    [],
    'an archived section must be moved, not copied',
  );
});
