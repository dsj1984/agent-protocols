import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubProvider } from '../../.agents/scripts/providers/github.js';

// Mock global fetch
const originalFetch = global.fetch;
process.env.GITHUB_TOKEN = 'mock-token';

test('GitHubProvider: getTicket handles simple ticket', async () => {
  global.fetch = async (url) => ({
    ok: true,
    json: async () => {
      if (url.includes('/issues/')) {
        return {
          number: 123,
          id: 456,
          node_id: 'node_123',
          title: 'Test Ticket',
          body: 'Parent: #1\n**Focus Areas**: lib',
          labels: [{ name: 'type::task' }],
          assignees: [],
          state: 'open',
        };
      }
    },
  });

  const provider = new GitHubProvider({ owner: 'owner', repo: 'repo' });
  const ticket = await provider.getTicket(123);
  assert.equal(ticket.id, 123);
  assert.equal(ticket.title, 'Test Ticket');
  assert.ok(ticket.labels.includes('type::task'));
});

test('GitHubProvider: getEpic parses PRD/TechSpec links', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      number: 1,
      id: 111,
      node_id: 'node_1',
      title: 'Epic Title',
      body: 'PRD: #2\nTech Spec: #3',
      labels: [{ name: 'type::epic' }],
    }),
  });

  const provider = new GitHubProvider({ owner: 'owner', repo: 'repo' });
  const epic = await provider.getEpic(1);
  assert.equal(epic.id, 1);
  assert.equal(epic.linkedIssues.prd, 2);
  assert.equal(epic.linkedIssues.techSpec, 3);
});

test('GitHubProvider: getTickets filters by labels', async () => {
  global.fetch = async (url) => ({
    ok: true,
    json: async () => {
      if (url.includes('/issues')) {
        return [
          {
            number: 1,
            id: 101,
            title: 'T1',
            body: 'Epic: #10',
            labels: [{ name: 'type::task' }],
            state: 'open',
          },
        ];
      }
      return [];
    },
  });

  const provider = new GitHubProvider({ owner: 'owner', repo: 'repo' });
  // getTickets(epicId, filters)
  const tickets = await provider.getTickets(10);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].id, 1);
});

test('GitHubProvider: postComment calls GraphQL mutation', async () => {
  let _callCount = 0;
  global.fetch = async () => {
    _callCount++;
    return {
      ok: true,
      json: async () => ({ id: 'comment-1' }),
    };
  };

  const provider = new GitHubProvider({ owner: 'owner', repo: 'repo' });
  const result = await provider.postComment(1, 'Hello');
  assert.equal(result.commentId, 'comment-1');
});

test('GitHubProvider._updateLabels: add-only fast path uses labels endpoint', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, method: init?.method });
    return { ok: true, json: async () => ({}) };
  };

  const provider = new GitHubProvider({ owner: 'o', repo: 'r' });
  const result = await provider._updateLabels(
    42,
    { add: ['agent::executing'] },
    /* hasOtherPatchFields */ false,
  );

  assert.equal(result.skipPatch, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/issues/42/labels'));
  assert.equal(calls[0].method, 'POST');
});

test('GitHubProvider._updateLabels: removal path merges current labels', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, method: init?.method });
    if (url.includes('/issues/42') && !url.endsWith('/labels')) {
      return {
        ok: true,
        json: async () => ({
          number: 42,
          id: 42,
          node_id: 'n',
          title: 't',
          body: '',
          labels: [{ name: 'agent::executing' }, { name: 'type::task' }],
          assignees: [],
          state: 'open',
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const provider = new GitHubProvider({ owner: 'o', repo: 'r' });
  const result = await provider._updateLabels(
    42,
    { add: ['agent::done'], remove: ['agent::executing'] },
    /* hasOtherPatchFields */ false,
  );

  assert.equal(result.skipPatch, false);
  assert.ok(result.mergedLabels.includes('agent::done'));
  assert.ok(result.mergedLabels.includes('type::task'));
  assert.ok(!result.mergedLabels.includes('agent::executing'));
});

test('GitHubProvider._updateLabels: combined patch path skips fast endpoint', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({
        number: 42,
        id: 42,
        node_id: 'n',
        title: 't',
        body: '',
        labels: [],
        assignees: [],
        state: 'open',
      }),
    };
  };

  const provider = new GitHubProvider({ owner: 'o', repo: 'r' });
  const result = await provider._updateLabels(
    42,
    { add: ['x'] },
    /* hasOtherPatchFields */ true,
  );

  assert.equal(result.skipPatch, false);
  assert.ok(result.mergedLabels.includes('x'));
  // Did NOT call the /labels fast-path endpoint
  assert.ok(!calls.some((u) => u.endsWith('/issues/42/labels')));
});

test('GitHubProvider: getTicket memoizes within an instance', async () => {
  let fetchCount = 0;
  global.fetch = async (url) => {
    if (url.includes('/issues/') && !url.includes('/comments')) {
      fetchCount++;
    }
    return {
      ok: true,
      json: async () => ({
        number: 77,
        id: 770,
        node_id: 'node_77',
        title: 'Memo Ticket',
        body: '',
        labels: [{ name: 'type::task' }],
        assignees: [],
        state: 'open',
      }),
    };
  };

  const provider = new GitHubProvider({ owner: 'owner', repo: 'repo' });
  await provider.getTicket(77);
  await provider.getTicket(77);
  await provider.getTicket(77);
  assert.equal(fetchCount, 1, 'only one REST round-trip for repeated reads');
});

test('GitHubProvider: primeTicketCache + invalidateTicket', async () => {
  let fetchCount = 0;
  global.fetch = async (url) => {
    if (url.includes('/issues/') && !url.includes('/comments')) {
      fetchCount++;
    }
    return {
      ok: true,
      json: async () => ({
        number: 88,
        id: 880,
        node_id: 'node_88',
        title: 'Primed',
        body: '',
        labels: [],
        assignees: [],
        state: 'open',
      }),
    };
  };

  const provider = new GitHubProvider({ owner: 'owner', repo: 'repo' });
  provider.primeTicketCache([
    { id: 88, title: 'Primed', body: '', labels: [] },
  ]);

  await provider.getTicket(88);
  assert.equal(fetchCount, 0, 'primed entry served from cache');

  provider.invalidateTicket(88);
  await provider.getTicket(88);
  assert.equal(fetchCount, 1, 'invalidated entry triggers a re-fetch');
});

test('GitHubProvider: getSubTickets paginates the GraphQL subIssues query', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    // Parent issue REST fetch (for getTicket(parentId))
    if (url.includes('/issues/1') && !url.includes('graphql')) {
      return {
        ok: true,
        json: async () => ({
          number: 1,
          id: 1,
          node_id: 'epic-node',
          title: 'Parent',
          body: '',
          labels: [{ name: 'type::epic' }],
          assignees: [],
          state: 'open',
        }),
      };
    }
    // Epic-type parents trigger a getTickets reverse lookup — return empty.
    if (url.includes('/issues?')) {
      return { ok: true, json: async () => [] };
    }
    // GraphQL — emulate two-page pagination.
    if (url.includes('/graphql')) {
      const body = init?.body ? JSON.parse(init.body) : {};
      const cursor = body.variables?.cursor;
      if (!cursor) {
        return {
          ok: true,
          json: async () => ({
            data: {
              node: {
                subIssues: {
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                  nodes: [
                    {
                      number: 10,
                      databaseId: 1010,
                      id: 'node-10',
                      title: 'Child 10',
                      body: '',
                      state: 'OPEN',
                      labels: { nodes: [{ name: 'type::task' }] },
                      assignees: { nodes: [] },
                    },
                  ],
                },
              },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            node: {
              subIssues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    number: 11,
                    databaseId: 1011,
                    id: 'node-11',
                    title: 'Child 11',
                    body: '',
                    state: 'CLOSED',
                    labels: { nodes: [{ name: 'type::task' }] },
                    assignees: { nodes: [{ login: 'alice' }] },
                  },
                ],
              },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const provider = new GitHubProvider({ owner: 'o', repo: 'r' });
  const subs = await provider.getSubTickets(1);

  // Both pages returned
  const ids = subs.map((t) => t.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [10, 11]);

  // State normalised to lowercase
  const child11 = subs.find((t) => t.id === 11);
  assert.equal(child11.state, 'closed');
  assert.deepEqual(child11.assignees, ['alice']);
  assert.ok(child11.labelSet instanceof Set);
  assert.ok(child11.labelSet.has('type::task'));

  // No REST fan-out per child — cache seeded by the GraphQL call.
  const restChildCalls = calls.filter(
    (c) => /\/issues\/1[01]$/.test(c.url) && !c.url.includes('graphql'),
  );
  assert.equal(
    restChildCalls.length,
    0,
    'Per-child REST fan-out should be eliminated',
  );

  // GraphQL was called twice (two pages).
  const gqlCalls = calls.filter((c) => c.url.endsWith('/graphql'));
  assert.equal(gqlCalls.length, 2);
});

test('GitHubProvider: getTicket returns labelSet in sync with labels', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      number: 42,
      id: 4200,
      node_id: 'n-42',
      title: 'T',
      body: '',
      labels: [{ name: 'type::task' }, { name: 'agent::done' }],
      assignees: [],
      state: 'closed',
    }),
  });

  const provider = new GitHubProvider({ owner: 'o', repo: 'r' });
  const t = await provider.getTicket(42);
  assert.ok(t.labelSet instanceof Set);
  assert.equal(t.labelSet.size, t.labels.length);
  for (const l of t.labels) assert.ok(t.labelSet.has(l));
});

// Restore fetch
test('GitHubProvider: cleanup', () => {
  global.fetch = originalFetch;
});
