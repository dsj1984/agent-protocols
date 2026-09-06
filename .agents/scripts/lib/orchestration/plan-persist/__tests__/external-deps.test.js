/**
 * external-deps.test.js — cross-plan `depends_on` refs (Story #5155).
 *
 * A `#<id>` entry names a blocker that already exists on the tracker. The
 * refusals below all run **before any create**, which is the point: an
 * unresolvable blocker discovered afterwards would sit on a live Story as a
 * gate nothing can ever lift, and the delivery engine reads that as a
 * permanent wedge rather than as an error worth reporting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertExternalDependenciesResolvable,
  collectExternalDependencyIds,
  externalDependencyId,
  isExternalDependencyRef,
} from '../external-deps.js';

const OPEN_STORY = { state: 'open', labels: ['type::story'] };

function providerDouble(tickets = {}) {
  return {
    getTicket: async (id) => {
      if (!(id in tickets)) return null;
      const t = tickets[id];
      if (t instanceof Error) throw t;
      return t;
    },
  };
}

describe('the lexical split between a sibling slug and an external ref', () => {
  it('recognises only `#<digits>` as external', () => {
    assert.equal(isExternalDependencyRef('#123'), true);
    assert.equal(isExternalDependencyRef('  #123  '), true);
    assert.equal(isExternalDependencyRef('some-slug'), false);
    assert.equal(isExternalDependencyRef('#12a'), false);
    assert.equal(
      isExternalDependencyRef('123'),
      false,
      'a bare number is a slug',
    );
    assert.equal(isExternalDependencyRef(null), false);
  });

  it('extracts the id, and null for a sibling slug', () => {
    assert.equal(externalDependencyId('#4712'), 4712);
    assert.equal(externalDependencyId('adopt-an-epic'), null);
    assert.equal(externalDependencyId('#0'), null);
  });

  it('collects distinct ids across a plan in first-seen order', () => {
    const stories = [
      { depends_on: ['#20', 'sib'] },
      { depends_on: ['#10', '#20'] },
      {},
    ];
    assert.deepEqual(collectExternalDependencyIds(stories), [20, 10]);
  });
});

describe('assertExternalDependenciesResolvable', () => {
  it('passes when every ref is an open Story', async () => {
    const provider = providerDouble({ 10: OPEN_STORY, 20: OPEN_STORY });
    const ids = await assertExternalDependenciesResolvable({
      provider,
      stories: [
        { slug: 'a', depends_on: ['#10', 'sib'] },
        { slug: 'b', depends_on: ['#20'] },
      ],
    });
    assert.deepEqual(ids, [10, 20]);
  });

  it('is a no-op with no external refs — no provider needed at all', async () => {
    assert.deepEqual(
      await assertExternalDependenciesResolvable({
        provider: {},
        stories: [{ slug: 'a', depends_on: ['sib'] }],
      }),
      [],
    );
  });

  it('refuses a CLOSED blocker — the edge would never lift', async () => {
    const provider = providerDouble({
      10: { state: 'closed', labels: ['type::story'] },
    });
    await assert.rejects(
      () =>
        assertExternalDependenciesResolvable({
          provider,
          stories: [{ slug: 'a', depends_on: ['#10'] }],
        }),
      /#10 is closed/,
    );
  });

  it('refuses a container Epic — an Epic is never delivered', async () => {
    const provider = providerDouble({
      11: { state: 'open', labels: ['type::epic'] },
    });
    await assert.rejects(
      () =>
        assertExternalDependenciesResolvable({
          provider,
          stories: [{ slug: 'a', depends_on: ['#11'] }],
        }),
      /container Epic/,
    );
  });

  it('refuses a missing issue and a non-Story', async () => {
    const provider = providerDouble({
      13: { state: 'open', labels: ['type::bug'] },
    });
    await assert.rejects(
      () =>
        assertExternalDependenciesResolvable({
          provider,
          stories: [{ slug: 'a', depends_on: ['#12'] }],
        }),
      /#12 does not exist/,
    );
    await assert.rejects(
      () =>
        assertExternalDependenciesResolvable({
          provider,
          stories: [{ slug: 'a', depends_on: ['#13'] }],
        }),
      /is not a type::story/,
    );
  });

  it('reports EVERY bad ref in one pass, not just the first', async () => {
    const provider = providerDouble({
      10: { state: 'closed', labels: ['type::story'] },
    });
    await assert.rejects(
      () =>
        assertExternalDependenciesResolvable({
          provider,
          stories: [{ slug: 'a', depends_on: ['#10', '#99'] }],
        }),
      (err) => {
        assert.match(err.message, /2 external depends_on reference/);
        assert.match(err.message, /#10 is closed/);
        assert.match(err.message, /#99 does not exist/);
        return true;
      },
    );
  });

  it('refuses when the provider cannot read tickets at all', async () => {
    await assert.rejects(
      () =>
        assertExternalDependenciesResolvable({
          provider: {},
          stories: [{ slug: 'a', depends_on: ['#10'] }],
        }),
      /exposes no getTicket/,
    );
  });
});
