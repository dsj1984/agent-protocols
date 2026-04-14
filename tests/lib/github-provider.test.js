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

// Restore fetch
test('GitHubProvider: cleanup', () => {
  global.fetch = originalFetch;
});
