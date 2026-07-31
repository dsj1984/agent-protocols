/**
 * maintainability-unscorable.test.js — the "we could not score this, and we are
 * saying so" path.
 *
 * A file the kernel throws on gets no baseline row. That part is correct: an
 * `mi: 0` phantom would drag the rollup floor down. What was wrong was doing it
 * silently — the scorer emitted nothing, so an unmeasured file was
 * indistinguishable from a file nobody had added, and no amount of re-seeding
 * could ever produce the missing row.
 *
 * These tests pin the two halves: unscorable files stay out of the score map,
 * and they get reported with the kernel's own reason attached.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  isScored,
  reportUnscorable,
} from '../../.agents/scripts/lib/maintainability-unscorable.js';
import { calculateAll } from '../../.agents/scripts/lib/maintainability-utils.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

describe('isScored', () => {
  it('accepts an entry carrying a real index', () => {
    assert.equal(isScored({ relPath: 'a.js', score: 87.5 }), true);
    assert.equal(
      isScored({ relPath: 'a.js', score: 87.5, unscorable: false }),
      true,
    );
  });

  it('rejects an unscorable entry even though its score is a number', () => {
    // The whole point: `score: 0` looks like a valid index to a naive filter.
    assert.equal(
      isScored({ relPath: 'a.js', score: 0, unscorable: true }),
      false,
    );
  });

  it('rejects the null-score I/O-failure entry', () => {
    assert.equal(isScored({ relPath: 'a.js', score: null }), false);
  });

  it('rejects a missing entry rather than throwing', () => {
    assert.equal(isScored(undefined), false);
    assert.equal(isScored(null), false);
  });
});

describe('reportUnscorable', () => {
  it('returns 0 and stays silent when everything scored', () => {
    assert.equal(reportUnscorable([{ relPath: 'a.js', score: 90 }]), 0);
    assert.equal(reportUnscorable([]), 0);
    assert.equal(reportUnscorable(undefined), 0);
  });

  it('counts every unscorable entry', () => {
    const count = reportUnscorable([
      { relPath: 'a.js', score: 90 },
      {
        relPath: 'b.js',
        score: 0,
        unscorable: true,
        reason: 'TypeError: boom',
      },
      { relPath: 'c.js', score: 0, unscorable: true, reason: null },
    ]);
    assert.equal(count, 2);
  });
});

describe('calculateAll — unscorable files', () => {
  let workDir;
  let originalCwd;

  before(() => {
    workDir = fs.realpathSync(makeTempDir('mi-unscorable-'));
    originalCwd = process.cwd();
    process.chdir(workDir);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('omits an unscorable file from the score map but keeps its neighbours', async () => {
    const good = path.join(workDir, 'good.js');
    const broken = path.join(workDir, 'broken.js');
    fs.writeFileSync(good, 'export function f(a) { return a + 1; }\n');
    // Genuinely invalid syntax — the one thing that must still be unscorable
    // after the AST compat shim closed the Babel-shape gaps.
    fs.writeFileSync(broken, 'export function ( { ] }\n');

    const scores = await calculateAll([good, broken]);

    assert.ok(
      Object.hasOwn(scores, 'good.js'),
      'the scorable neighbour must still get a row',
    );
    assert.equal(
      Object.hasOwn(scores, 'broken.js'),
      false,
      'an unscorable file must NOT get a row — an mi:0 phantom poisons the rollup',
    );
  });

  it('scores a file whose only oddity is syntax the kernel used to choke on', async () => {
    // Regression guard for the whole point of escomplex-ast-compat: this file
    // is perfectly valid and used to abort the entire analysis.
    const modern = path.join(workDir, 'modern.js');
    fs.writeFileSync(
      modern,
      [
        'export function tokenise(text) {',
        '  const out = [];',
        '  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {',
        '    if (token) out.push(token);',
        '  }',
        '  return out;',
        '}',
        '',
      ].join('\n'),
    );

    const scores = await calculateAll([modern]);

    assert.ok(
      typeof scores['modern.js'] === 'number' && scores['modern.js'] > 0,
      `expected a real index, got ${scores['modern.js']}`,
    );
  });
});
