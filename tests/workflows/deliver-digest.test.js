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
