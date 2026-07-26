import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Story #4786 — contract tests for the decision log and the pattern archive.
 *
 * These pin the three invariants the ADR pruning depends on:
 *
 *   1. An `Accepted` ADR names a `**Surface:**` path that exists on disk. An
 *      ADR is a claim about the current system; a decision cannot be in force
 *      while the file it decided is gone. Body paths are deliberately NOT
 *      checked — an ADR legitimately records what was true when written.
 *   2. Every ADR identifier in `docs/decisions.md` is unique, so a
 *      cross-reference by identifier resolves to exactly one entry.
 *   3. Every section archived out of `docs/patterns.md` leaves a pointer line
 *      behind in the live doc, so relocated history is never orphaned.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECISIONS = path.join(REPO_ROOT, 'docs', 'decisions.md');
const PATTERNS = path.join(REPO_ROOT, 'docs', 'patterns.md');
const ARCHIVE = path.join(REPO_ROOT, 'docs', 'archive', 'patterns-2026-07.md');

/** Split a decision log into `## `-delimited entries. */
export function parseAdrs(source) {
  const lines = source.split('\n');
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
      isAdr: statusLine !== '',
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

test('every Accepted ADR names a Surface path that exists on disk', () => {
  const adrs = parseAdrs(fs.readFileSync(DECISIONS, 'utf8')).filter((a) => a.isAdr);
  assert.ok(adrs.length > 20, `expected a populated decision log, saw ${adrs.length} entries`);

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
  const adrs = parseAdrs(fs.readFileSync(DECISIONS, 'utf8')).filter((a) => a.isAdr);
  const seen = new Map();
  const duplicates = [];
  for (const adr of adrs) {
    const id = adrIdentifier(adr.title);
    if (!id) continue;
    if (seen.has(id)) duplicates.push(`${id}: L${seen.get(id)} and L${adr.line}`);
    else seen.set(id, adr.line);
  }
  assert.deepEqual(duplicates, [], 'a cross-reference by identifier must resolve to exactly one entry');
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
  assert.deepEqual([...new Set(broken)], [], 'in-document anchor links must resolve to a heading');
});

test('the index lists every ADR with its current status', () => {
  const source = fs.readFileSync(DECISIONS, 'utf8');
  const start = source.indexOf('<!-- ADR-INDEX:START -->');
  const end = source.indexOf('<!-- ADR-INDEX:END -->');
  assert.ok(start !== -1 && end > start, 'docs/decisions.md must carry a delimited index block');
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
  assert.ok(closedHeading !== -1, 'the index must separate in-force entries from closed ones');
  for (const adr of adrs.filter((a) => a.isAccepted)) {
    const at = index.indexOf(`#${slugify(adr.title)}`);
    assert.ok(at < closedHeading, `Accepted ADR listed under Closed: ${adr.title}`);
  }
});

test('every archived pattern section has a pointer line in docs/patterns.md', () => {
  const archive = fs.readFileSync(ARCHIVE, 'utf8');
  const live = fs.readFileSync(PATTERNS, 'utf8');

  const sections = archive
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());
  assert.ok(sections.length >= 5, `expected the archived sections, saw ${sections.length}`);

  const orphaned = sections.filter(
    (heading) => !live.includes(`[${heading}](archive/patterns-2026-07.md#${slugify(heading)})`),
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
  assert.deepEqual([...new Set(broken)], [], 'archive pointers must resolve to an archived section');
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
  assert.deepEqual(duplicated, [], 'an archived section must be moved, not copied');
});
