/**
 * tests/workflows/deliver-digest.test.js — Story #4736, AC-5.
 *
 * The deliver path used to re-read the same helper/schema set every session —
 * nine separate reads on one measured delivery, each one growing the resident
 * context every later turn re-pays. `helpers/deliver-digest.md` is the single
 * bundled read that replaces them.
 *
 * A digest only earns its existence if two things stay true, and neither is
 * self-enforcing:
 *
 *   1. It **covers** what the engine always needs. A digest missing the
 *      terminal statuses or the acceptance gate sends the reader back to the
 *      files it was meant to replace — worse than no digest, because it is
 *      paid for AND bypassed.
 *   2. It stays **bounded**. The failure mode for a bundle is accretion: it
 *      absorbs situational material until it is as expensive as the reads it
 *      replaced. The ceiling makes that regression a red test rather than a
 *      slow drift.
 *
 * And the spine files must actually point at it, or nothing routes through it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveCeremonyForRisk } from '../../.agents/scripts/lib/orchestration/ceremony-routing.js';
import { deriveChangeLevel } from '../../.agents/scripts/lib/orchestration/review-depth.js';
import { assertDocMentions } from '../helpers/doc-assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS = path.join(REPO_ROOT, '.agents', 'workflows');
const DIGEST = path.join(WORKFLOWS, 'helpers', 'deliver-digest.md');

/**
 * Ceiling for the bundle. Comfortably above what the always-needed material
 * costs today and far below the ~5× that re-reading the individual files did.
 */
const DIGEST_BUDGET_BYTES = 8 * 1024;

const read = (p) => readFileSync(p, 'utf8');

describe('helpers/deliver-digest.md — the one bundled deliver read (AC-5)', () => {
  it('covers every always-needed surface the engine would otherwise re-read', () => {
    const digest = read(DIGEST);
    /** [what the reader came for, a token that proves it is actually here] */
    const coverage = [
      ['the dispatch decision', 'dispatchMode'],
      ['the single-Story inline rule', 'one-Story run'],
      ['the branch/merge invariants', 'story-<id>'],
      ['the change-set-once discipline', 'computeChangeSet'],
      ['the ceremony resolution', 'resolveCeremonyForRisk'],
      ['the deriveChangeLevel argument key', 'changedFiles'],
      ['the deriveChangeLevel return shape', '{ level, classes }'],
      ['the resolveCeremonyForRisk argument key', 'derivedLevel'],
      ['the acceptance gate invocation', 'acceptance-eval.js'],
      ['the terminal envelope marker', '--- STORY DELIVER TERMINAL ---'],
      ['the state-transition command', 'update-ticket-state.js'],
    ];
    for (const [surface, token] of coverage) {
      assert.ok(
        digest.includes(token),
        `the digest no longer covers ${surface} (missing "${token}") — a reader hitting that gap falls back to the per-file reads the digest exists to replace`,
      );
    }
    for (const status of ['landed', 'pending', 'blocked', 'failed']) {
      assert.ok(
        digest.includes(`\`${status}\``),
        `the digest omits the "${status}" terminal status, so a caller cannot branch on the envelope without opening the schema`,
      );
    }
  });

  it('stays inside its byte budget', () => {
    const bytes = Buffer.byteLength(read(DIGEST), 'utf8');
    assert.ok(
      bytes <= DIGEST_BUDGET_BYTES,
      `deliver-digest.md is ${bytes} bytes, over the ${DIGEST_BUDGET_BYTES}-byte budget — situational material belongs in deliver-story-reference.md / deliver-reference.md, not the always-read bundle`,
    );
  });

  it('is reachable from both deliver spines', () => {
    for (const spine of [
      path.join(WORKFLOWS, 'deliver.md'),
      path.join(WORKFLOWS, 'helpers', 'deliver-story.md'),
    ]) {
      assert.ok(
        read(spine).includes('deliver-digest.md'),
        `${path.relative(REPO_ROOT, spine)} does not link the digest — an unreferenced bundle is paid for by nobody and read by nobody`,
      );
    }
  });

  it('the spine cites the digest instead of restating the terminal table', () => {
    const spine = read(path.join(WORKFLOWS, 'helpers', 'deliver-story.md'));
    assert.ok(
      spine.includes('digest § 5'),
      'deliver-story.md must route Step 3 / Step 7 at the digest, not carry its own copy of the status table',
    );
  });
});

describe('helpers/deliver-story.md — the orphaned-envelope fallback (#4816)', () => {
  const read = (p) => readFileSync(p, 'utf8');
  const spine = () => read(path.join(WORKFLOWS, 'helpers', 'deliver-story.md'));

  it('sends an envelope-less child turn to the persisted file first', () => {
    // Persisting the envelope buys nothing unless the router is told to read
    // it: the whole cost this removes is the recovery round trip a caller
    // pays when a worker's turn ended before it could relay.
    assertDocMentions(
      spine(),
      /temp\/orchestration\/story-deliver-terminal-<storyId>\.json/,
      'deliver-story.md must name the persisted envelope path',
    );
    assertDocMentions(
      spine(),
      /[Ll]ost envelope first: read it off disk/,
      'the fallback must come BEFORE the recovery probe, not as a footnote to it',
    );
  });

  it('warns that a live close must not be re-initialized underneath', () => {
    assertDocMentions(
      spine(),
      /close-in-flight/,
      'deliver-story.md must name the shape the probe now returns for a live close',
    );
    assertDocMentions(
      spine(),
      /never re-init underneath it/i,
      'the hazard (two closes racing one PR) must be stated where the operator reads it',
    );
  });
});

describe('deliver-digest § 3 — the ceremony incantation, verified by execution (#4904)', () => {
  // § 3 is the only place the deliver path learns how to route ceremony, and a
  // prose assertion cannot protect it: both functions are total, so a
  // wrong-shaped argument raises nothing and merely resolves to the `null`
  // fail-safe — a fresh critic sub-agent bought on every low-risk Story, with
  // no error anywhere to attribute the cost to. Grepping the markdown for
  // `changedFiles` would still pass after the parameter was renamed in source.
  // So these two tests CALL the documented composition instead.

  it('yields a real level and a real mode when called with the documented shapes', () => {
    // Arrange — the digest's own argument shape and nothing else, against the
    // real audit-rules.json manifest the deliverer would hit.
    const changedFiles = ['docs/onboarding.md', 'README.md'];

    // Act — the composition exactly as § 3 spells it out.
    const derived = deriveChangeLevel({ changedFiles });
    const ceremony = resolveCeremonyForRisk({
      derivedLevel: derived.level,
      clusterIndex: 0,
    });

    // Assert — a derivable level is the whole point: `null` here would mean
    // `changedFiles` is no longer the key `deriveChangeLevel` reads.
    assert.notEqual(
      derived.level,
      null,
      'deriveChangeLevel({ changedFiles }) returned the null fail-safe for an enumerable, non-sensitive change set — the documented argument key no longer reaches the derivation',
    );
    assert.ok(
      Array.isArray(derived.classes),
      'deriveChangeLevel must return { level, classes } — § 3 documents the classes array, so a caller destructuring it cannot get undefined',
    );
    assert.ok(
      ceremony.mode === 'fresh' || ceremony.mode === 'inline',
      `resolveCeremonyForRisk({ derivedLevel }) must resolve a concrete mode, got ${JSON.stringify(ceremony.mode)}`,
    );
    assert.equal(
      ceremony.verdictOwner,
      ceremony.mode === 'fresh' ? 'fresh-critic' : 'inline-self-eval',
      'the resolved decision must name its single verdict owner — § 3 promises verdictOwner on the returned object',
    );
  });

  it('routes the object-for-string mistake to the null fail-safe, never a low verdict', () => {
    // Arrange — pin the level to `low` independently of the shipped manifest by
    // injecting the documented `selectSensitivePathClassesFn` seam, so the only
    // variable between the two resolutions below is the argument SHAPE.
    const derived = deriveChangeLevel({
      changedFiles: ['docs/onboarding.md'],
      selectSensitivePathClassesFn: () => [],
    });
    assert.equal(
      derived.level,
      'low',
      'precondition: an injected no-match selector must derive `low`',
    );

    // Act — the documented composition, then the mistake the old § 3 wording
    // invited: handing `derivedLevel` the whole result object. Sampling is
    // disabled in both so the floor cannot account for any difference.
    const documented = resolveCeremonyForRisk({
      derivedLevel: derived.level,
      clusterIndex: 1,
      freshCriticSampleRate: 0,
    });
    const mistaken = resolveCeremonyForRisk({
      derivedLevel: derived,
      clusterIndex: 1,
      freshCriticSampleRate: 0,
    });

    // Assert — the two disagree, which is what makes the documented shape
    // load-bearing rather than decorative.
    assert.equal(
      documented.mode,
      'inline',
      'a `low` level with sampling off must resolve inline — otherwise the digest is documenting a composition that never buys the cheap path',
    );
    assert.equal(
      mistaken.mode,
      'fresh',
      'passing the { level, classes } object as derivedLevel must hit the null fail-safe; if this ever resolves inline the fail-safe has inverted',
    );
    assert.match(
      mistaken.reason,
      /underivable/,
      'the fail-safe must say the level was underivable — that string is the only evidence a deliverer has that it paid for a fresh critic by mis-shaping the call',
    );
    assert.notEqual(
      mistaken.mode,
      documented.mode,
      'object-for-string must be observably different from the documented call, or § 3 stating the shape guards nothing',
    );
  });
});
