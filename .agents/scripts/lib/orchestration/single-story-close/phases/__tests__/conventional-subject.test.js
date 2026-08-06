/**
 * conventional-subject.test.js — regression gates for the three squash-subject
 * rules the squash-subject repair fixed. Each `assert` here corresponds to a subject
 * observed live on `main` that the old derivation got wrong.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectBreakingNotes,
  isConventionalSubject,
  markBreaking,
  pickDominantType,
  shapeDescription,
} from '../conventional-subject.js';

// ---------------------------------------------------------------------------
// Rule 1 — type precedence follows release impact
// ---------------------------------------------------------------------------

test('pickDominantType: a release-significant type outranks housekeeping', () => {
  assert.equal(
    pickDominantType(['chore(gates): x', 'feat(cli): y', 'docs(ci): z']),
    'feat',
  );
  assert.equal(pickDominantType(['docs: a', 'fix: b']), 'fix');
  assert.equal(pickDominantType(['chore: a', 'perf: b', 'docs: c']), 'perf');
  assert.equal(pickDominantType(['test: a', 'refactor: b']), 'refactor');
});

test('pickDominantType: the visible tier is strictly ordered', () => {
  const all = [
    'ci: k',
    'chore: j',
    'style: i',
    'test: h',
    'docs: g',
    'refactor: f',
    'revert: e',
    'perf: d',
    'fix: c',
    'feat: b',
  ];
  assert.equal(pickDominantType(all), 'feat');
  assert.equal(pickDominantType(all.slice(0, -1)), 'fix');
  assert.equal(pickDominantType(all.slice(0, -2)), 'perf');
  assert.equal(pickDominantType(all.slice(0, -3)), 'revert');
  assert.equal(pickDominantType(all.slice(0, -4)), 'refactor');
});

test('pickDominantType: Story #5004 resolves to chore, not docs', () => {
  // The live defect: `docs` outranked `chore` on a hand-ordered list, so a
  // three-commit sweep that deleted five modules, two CLIs and a dependency
  // landed on `main` as `docs: …`. Inside the hidden tier there is no honest
  // ordering, so the branch's own weight decides — two chores beat one docs.
  assert.equal(
    pickDominantType([
      'chore(gates): baseline-refresh: retire vacuous gates, mirror CI in verify (refs #5004)',
      'docs(ci): rewrite known-tooling-behavior entry 2 (refs #5004)',
      'chore(baselines): prune orphan rows (refs #5004)',
    ]),
    'chore',
  );
});

test('pickDominantType: an even hidden-tier split falls to the primary commit', () => {
  // `subjects` is oldest-first, so index 0 is the commit the operator wrote
  // before any fixup piled on.
  assert.equal(pickDominantType(['docs: a', 'chore: b']), 'docs');
  assert.equal(pickDominantType(['chore: a', 'docs: b']), 'chore');
});

test('pickDominantType: non-conventional subjects are ignored, empty is null', () => {
  assert.equal(pickDominantType(['Rename the package', 'docs: a']), 'docs');
  assert.equal(pickDominantType(['Rename the package']), null);
  assert.equal(pickDominantType([]), null);
  assert.equal(pickDominantType(undefined), null);
});

test('pickDominantType: a breaking marker does not hide the type', () => {
  assert.equal(pickDominantType(['chore: a', 'feat(api)!: b']), 'feat');
});

// ---------------------------------------------------------------------------
// Rule 2 — casing leaves acronyms alone
// ---------------------------------------------------------------------------

test('shapeDescription: preserves a leading acronym', () => {
  // The live defect: `refactor: cRAP surface diet …` on `main`.
  assert.equal(
    shapeDescription('CRAP surface diet: delete the dead combined scan'),
    'CRAP surface diet: delete the dead combined scan',
  );
  assert.equal(shapeDescription('API surface diet'), 'API surface diet');
  assert.equal(shapeDescription('CI mirror repair'), 'CI mirror repair');
  assert.equal(shapeDescription('QA loop rework'), 'QA loop rework');
  assert.equal(shapeDescription('CI/CD split'), 'CI/CD split');
  assert.equal(shapeDescription('CRAP: retire rows'), 'CRAP: retire rows');
});

test('shapeDescription: still lowercases an ordinary leading word', () => {
  assert.equal(
    shapeDescription('Rename the published npm package'),
    'rename the published npm package',
  );
  assert.equal(shapeDescription('Story #4321'), 'story #4321');
  // Mixed-case and single-letter heads are not acronyms.
  assert.equal(shapeDescription('A11y sweep'), 'a11y sweep');
  assert.equal(shapeDescription('A sweep'), 'a sweep');
  assert.equal(shapeDescription('cRAP surface diet'), 'cRAP surface diet');
});

test('shapeDescription: trims and tolerates empty input', () => {
  assert.equal(shapeDescription('  Padded title  '), 'padded title');
  assert.equal(shapeDescription(''), '');
  assert.equal(shapeDescription(undefined), '');
});

// ---------------------------------------------------------------------------
// Rule 3 — breaking changes survive the squash
// ---------------------------------------------------------------------------

test('collectBreakingNotes: reads a footer out of any constituent commit', () => {
  const result = collectBreakingNotes({
    commitMessages: [
      'chore(gates): retire the lint-baseline shell\n\nSome prose.\n',
      'docs(ci): rewrite entry 2\n\nBREAKING CHANGE: `project.commands.lintBaseline` was removed from a\nschema block that is additionalProperties:false.\n',
      'chore(baselines): prune orphan rows\n',
    ],
  });
  assert.equal(result.breaking, true);
  assert.deepEqual(result.notes, [
    '`project.commands.lintBaseline` was removed from a schema block that is additionalProperties:false.',
  ]);
});

test('collectBreakingNotes: honours the hyphenated spelling and a `!` header', () => {
  assert.equal(
    collectBreakingNotes({
      commitMessages: ['fix: x\n\nBREAKING-CHANGE: the flag is gone.\n'],
    }).breaking,
    true,
  );
  const bang = collectBreakingNotes({
    commitMessages: ['feat(api)!: drop the v1 endpoint\n'],
  });
  assert.equal(bang.breaking, true);
  // No footer text → the `!` commit's own description is the note.
  assert.deepEqual(bang.notes, ['drop the v1 endpoint']);
});

test('collectBreakingNotes: a Story can declare the break itself', () => {
  const result = collectBreakingNotes({
    commitMessages: ['chore: tidy up\n'],
    storyBody:
      '## Spec\n\nRetire the shell.\n\nBREAKING CHANGE: consumers must delete\n`project.commands.lintBaseline`.\n\n## Verify\n\n- npm test\n',
  });
  assert.equal(result.breaking, true);
  assert.deepEqual(result.notes, [
    'consumers must delete `project.commands.lintBaseline`.',
  ]);
});

test('collectBreakingNotes: prose describing a break is not a declaration', () => {
  const result = collectBreakingNotes({
    commitMessages: [
      'chore: retire the shell\n\nThis is a breaking change for consumers who set the key.\n',
    ],
    storyBody: 'This story introduces a breaking change to the config schema.',
  });
  assert.equal(result.breaking, false);
  assert.deepEqual(result.notes, []);
});

test('collectBreakingNotes: a lowercase footer keyword does not fire', () => {
  // `conventional-commits-parser` matches the uppercase token only; announcing
  // a break release-please will not see would be worse than staying quiet.
  assert.equal(
    collectBreakingNotes({
      commitMessages: ['fix: x\n\nbreaking change: nope\n'],
    }).breaking,
    false,
  );
});

test('collectBreakingNotes: a trailer ends the note, and duplicates collapse', () => {
  const result = collectBreakingNotes({
    commitMessages: [
      'fix: a\n\nBREAKING CHANGE: the key is gone.\nRefs: #1\n',
      'fix: b\n\nBREAKING CHANGE: the key is gone.\n',
    ],
  });
  assert.deepEqual(result.notes, ['the key is gone.']);
});

test('collectBreakingNotes: nothing declared is not breaking', () => {
  assert.deepEqual(collectBreakingNotes({}), { breaking: false, notes: [] });
  assert.deepEqual(
    collectBreakingNotes({ commitMessages: ['chore: a\n'], storyBody: '' }),
    { breaking: false, notes: [] },
  );
});

test('markBreaking: inserts `!` where the parser reads it', () => {
  assert.equal(markBreaking('feat: add a thing'), 'feat!: add a thing');
  assert.equal(
    markBreaking('chore(gates): retire a gate'),
    'chore(gates)!: retire a gate',
  );
  // Idempotent, and a no-op on a subject it cannot parse.
  assert.equal(markBreaking('feat!: add a thing'), 'feat!: add a thing');
  assert.equal(markBreaking('Rename the package'), 'Rename the package');
});

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

test('isConventionalSubject', () => {
  assert.equal(isConventionalSubject('feat(cli): add a flag'), true);
  assert.equal(isConventionalSubject('feat(cli)!: add a flag'), true);
  assert.equal(isConventionalSubject('Rename the package'), false);
  assert.equal(isConventionalSubject('nope: not a known type'), false);
  assert.equal(isConventionalSubject('feat:'), false);
});

test('a scoped, breaking-marked subject still yields its type', () => {
  // `parseConventionalType` is module-private; `pickDominantType` is the seam
  // that reads it, so the scope/`!` tolerance is pinned through that.
  assert.equal(pickDominantType(['chore(gates)!: x']), 'chore');
  assert.equal(pickDominantType(['Rename the package']), null);
});
