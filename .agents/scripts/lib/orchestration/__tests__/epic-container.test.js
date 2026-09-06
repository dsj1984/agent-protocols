/**
 * epic-container.test.js — the container-Epic shape (Story #5139).
 *
 * The load-bearing assertions here are the *negative* ones: an Epic body must
 * carry no `## Spec` / `## Acceptance` / `## Verify`, because the Epic is a
 * pure container and anything unique living in it would be invisible to every
 * agent delivering the children.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composeEpicBody,
  isEpicTicket,
  normalizeChildIds,
  readEpicChildIds,
  readEpicChildIdsFrom,
} from '../epic-container.js';

describe('isEpicTicket', () => {
  it('reads the type::epic label in both label shapes', () => {
    assert.equal(isEpicTicket({ labels: ['type::epic'] }), true);
    assert.equal(isEpicTicket({ labels: [{ name: 'type::epic' }] }), true);
  });

  it('is false for a Story, a bare issue and a malformed input', () => {
    assert.equal(isEpicTicket({ labels: ['type::story'] }), false);
    assert.equal(isEpicTicket({ labels: [] }), false);
    assert.equal(isEpicTicket({}), false);
    assert.equal(isEpicTicket(null), false);
  });

  it('does not consult the body — a hand-edited Epic is still an Epic', () => {
    const epic = { labels: ['type::epic'], body: 'operator rewrote this' };
    assert.equal(isEpicTicket(epic), true);
  });
});

describe('composeEpicBody', () => {
  it('renders a goal paragraph and one checklist line per child', () => {
    const body = composeEpicBody({
      goal: 'Group the auth work.',
      childIds: [7, 8],
    });
    assert.match(body, /## Goal\n\nGroup the auth work\./);
    assert.match(body, /- \[ \] #7\n- \[ \] #8/);
  });

  it('carries NO execution payload — the container invariant', () => {
    const body = composeEpicBody({ goal: 'A goal.', childIds: [1] });
    assert.ok(!body.includes('## Spec'), 'an Epic must carry no Spec');
    assert.ok(
      !body.includes('## Acceptance'),
      'an Epic must carry no Acceptance',
    );
    assert.ok(!body.includes('## Verify'), 'an Epic must carry no Verify');
    assert.ok(!body.includes('## Changes'), 'an Epic must carry no Changes');
  });

  it('round-trips through readEpicChildIds', () => {
    const ids = [12, 34, 56];
    assert.deepEqual(
      readEpicChildIds(composeEpicBody({ goal: 'g', childIds: ids })),
      ids,
    );
  });

  it('renders an explicit empty state rather than a bare heading', () => {
    assert.match(composeEpicBody({ goal: 'g' }), /_No child Stories linked\._/);
  });

  it('throws on a missing or blank goal', () => {
    assert.throws(
      () => composeEpicBody({ goal: '', childIds: [1] }),
      /requires a goal/,
    );
    assert.throws(() => composeEpicBody({ goal: '   ' }), /requires a goal/);
    assert.throws(() => composeEpicBody({}), /requires a goal/);
  });
});

describe('readEpicChildIds', () => {
  it('reads checked and unchecked items alike', () => {
    const body = '## Stories\n\n- [ ] #10\n- [x] #11\n- [X] #12\n';
    assert.deepEqual(readEpicChildIds(body), [10, 11, 12]);
  });

  it('ignores an issue reference that is not a standalone checklist line', () => {
    const body = '## Goal\n\nSupersedes #99 and relates to #98.\n\n- [ ] #10\n';
    assert.deepEqual(readEpicChildIds(body), [10]);
  });

  it('does not leak regex lastIndex between calls', () => {
    const body = '- [ ] #1\n- [ ] #2\n';
    assert.deepEqual(readEpicChildIds(body), [1, 2]);
    assert.deepEqual(
      readEpicChildIds(body),
      [1, 2],
      're-read must be identical',
    );
  });

  it('returns [] for absent, empty and non-string bodies', () => {
    assert.deepEqual(readEpicChildIds(undefined), []);
    assert.deepEqual(readEpicChildIds(''), []);
    assert.deepEqual(readEpicChildIds(42), []);
  });
});

describe('normalizeChildIds', () => {
  it('dedupes, preserves first-seen order and drops non-positive integers', () => {
    assert.deepEqual(
      normalizeChildIds([3, 1, 3, 0, -2, 'x', null, 2]),
      [3, 1, 2],
    );
  });

  it('returns [] for a non-array', () => {
    assert.deepEqual(normalizeChildIds(null), []);
  });
});

describe('readEpicChildIdsFrom', () => {
  const epic = { number: 5, body: '- [ ] #10\n- [ ] #11\n' };

  it('unions the native edges with the body checklist, deduped', async () => {
    const ids = await readEpicChildIdsFrom({
      epic,
      readNativeChildIds: async () => [11, 12],
    });
    assert.deepEqual(ids, [11, 12, 10]);
  });

  it('falls back to the checklist alone when there is no native reader', async () => {
    assert.deepEqual(await readEpicChildIdsFrom({ epic }), [10, 11]);
  });

  it('degrades to the checklist and warns when the native read throws', async () => {
    const warnings = [];
    const ids = await readEpicChildIdsFrom({
      epic,
      readNativeChildIds: async () => {
        throw new Error('GraphQL unavailable');
      },
      onWarn: (m) => warnings.push(m),
    });
    assert.deepEqual(
      ids,
      [10, 11],
      'a failed API read must not lose the body children',
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Epic #5/);
    assert.match(warnings[0], /GraphQL unavailable/);
  });
});
