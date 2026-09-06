/**
 * epic-adoption.test.js — joining an Epic that already exists (Story #5155).
 *
 * The asymmetry these tests pin is the whole design, and it is the opposite
 * of creation's:
 *
 *   - **before any create**, a bad target is a HARD ERROR — the operator named
 *     a specific id, so silently not adopting it would leave them believing
 *     their Stories were filed somewhere they were not, and nothing has been
 *     written yet so the fix is free;
 *   - **after the Stories exist**, a failed checklist write or sub-issue edge
 *     only WARNS — refusing then would strand live Stories over a link.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adoptContainerEpic, resolveAdoptionTarget } from '../epic-adoption.js';

const OPEN_EPIC = {
  number: 90,
  title: 'Container',
  body: '## Goal\n\nGroup it.\n\n## Stories\n\n- [x] #41\n',
  labels: ['type::epic'],
  state: 'open',
};

/** A provider double over a fixed ticket table. */
function providerDouble({
  tickets = {},
  updateThrows = false,
  posts = [],
} = {}) {
  const updates = [];
  return {
    updates,
    posts,
    getTicket: async (id) => {
      if (!(id in tickets)) return null;
      const t = tickets[id];
      if (t instanceof Error) throw t;
      return t;
    },
    updateTicket: async (id, mutations) => {
      if (updateThrows) throw new Error('patch rejected');
      updates.push({ id, mutations });
    },
    getDependencyWriteContext: () => ({
      owner: 'o',
      repo: 'r',
      gh: {
        api: async ({ method, endpoint, body }) => {
          if (method === 'POST') posts.push({ endpoint, body });
          return {};
        },
      },
    }),
  };
}

describe('resolveAdoptionTarget — the pre-create refusals', () => {
  it('accepts an open container Epic', async () => {
    const provider = providerDouble({ tickets: { 90: OPEN_EPIC } });
    const target = await resolveAdoptionTarget({ provider, epicId: 90 });
    assert.equal(target.id, 90);
    assert.equal(target.title, 'Container');
  });

  it('refuses a missing id', async () => {
    const provider = providerDouble({ tickets: {} });
    await assert.rejects(
      () => resolveAdoptionTarget({ provider, epicId: 91 }),
      /#91 does not exist/,
    );
  });

  it('refuses a CLOSED Epic — a finished container is never reopened by a plan', async () => {
    const provider = providerDouble({
      tickets: { 92: { ...OPEN_EPIC, number: 92, state: 'closed' } },
    });
    await assert.rejects(
      () => resolveAdoptionTarget({ provider, epicId: 92 }),
      /is closed/,
    );
  });

  it('refuses an ordinary Story — adopting one would file the plan under a work item', async () => {
    const provider = providerDouble({
      tickets: { 93: { ...OPEN_EPIC, number: 93, labels: ['type::story'] } },
    });
    await assert.rejects(
      () => resolveAdoptionTarget({ provider, epicId: 93 }),
      /does not carry "type::epic"/,
    );
  });

  it('refuses a non-positive id and an unreadable ticket', async () => {
    const provider = providerDouble({
      tickets: { 94: new Error('api down') },
    });
    await assert.rejects(
      () => resolveAdoptionTarget({ provider, epicId: 0 }),
      /positive issue id/,
    );
    await assert.rejects(
      () => resolveAdoptionTarget({ provider, epicId: 94 }),
      /could not be read/,
    );
    await assert.rejects(
      () => resolveAdoptionTarget({ provider: {}, epicId: 90 }),
      /exposes no getTicket/,
    );
  });
});

describe('adoptContainerEpic — linking the cohort in', () => {
  const target = { id: 90, title: 'Container', body: OPEN_EPIC.body };

  it('appends one row per Story and mirrors an edge each — with no count floor', async () => {
    const provider = providerDouble({
      tickets: { 101: { internalId: 90101 } },
    });

    const result = await adoptContainerEpic({
      provider,
      target,
      created: [{ id: 101 }],
    });

    assert.equal(result.adopted, true);
    assert.deepEqual(result.childIds, [101]);
    assert.equal(provider.updates.length, 1, 'a SINGLE Story is adopted');
    const body = provider.updates[0].mutations.body;
    assert.ok(body.includes('- [ ] #101'));
    assert.ok(body.includes('- [x] #41'), 'the existing ticked child survives');
    assert.equal(provider.posts.length, 1);
    assert.equal(provider.posts[0].body.sub_issue_id, 90101);
  });

  it('writes nothing on a dry run', async () => {
    const provider = providerDouble({ tickets: {} });

    const result = await adoptContainerEpic({
      provider,
      target,
      created: [{ id: -1 }, { id: -2 }],
      opts: { dryRun: true },
    });

    assert.deepEqual(result.childIds, [-1, -2]);
    assert.equal(provider.updates.length, 0);
    assert.equal(provider.posts.length, 0);
  });

  it('warns rather than throws when the checklist write fails — the Stories are live', async () => {
    const provider = providerDouble({
      tickets: { 102: { internalId: 90102 } },
      updateThrows: true,
    });

    const result = await adoptContainerEpic({
      provider,
      target,
      created: [{ id: 102 }],
    });

    assert.equal(result.adopted, true, 'a lost checklist never fails the run');
    assert.equal(provider.posts.length, 1, 'the native edge is still written');
  });

  it('skips the patch entirely when every child is already listed', async () => {
    const provider = providerDouble({ tickets: { 41: { internalId: 9041 } } });

    await adoptContainerEpic({ provider, target, created: [{ id: 41 }] });

    assert.equal(provider.updates.length, 0, 'no no-op body rewrite');
  });

  it('returns null with no target and with no real created ids', async () => {
    const provider = providerDouble({ tickets: {} });
    assert.equal(
      await adoptContainerEpic({ provider, target: null, created: [] }),
      null,
    );
    assert.equal(
      await adoptContainerEpic({ provider, target, created: [{ id: -1 }] }),
      null,
    );
  });
});
