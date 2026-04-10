/**
 * GitHub Provider Tests
 *
 * Tests GitHubProvider with mocked fetch() responses — no live API calls.
 * Covers all 10 interface methods, auth resolution, error handling,
 * and dependency parsing.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { GitHubProvider } = await import(
  pathToFileURL(path.join(ROOT, '.agents', 'scripts', 'providers', 'github.js'))
    .href
);
const { ITicketingProvider } = await import(
  pathToFileURL(
    path.join(ROOT, '.agents', 'scripts', 'lib', 'ITicketingProvider.js'),
  ).href
);

// ---------------------------------------------------------------------------
// Helpers — mock fetch
// ---------------------------------------------------------------------------

function createRouteMock(routes) {
  const calls = [];

  const mockFn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const method = (opts.method || 'GET').toUpperCase();
    const bodyStr = opts.body || '';

    let matchedResponse = null;
    for (const [routePattern, response] of Object.entries(routes)) {
      const parts = routePattern.split(' ');
      const routeMethod = parts.length > 1 ? parts[0] : 'GET';
      const routePath = parts.length > 1 ? parts[1] : parts[0];
      const routeBodyMatcher =
        parts.length > 2 ? parts.slice(2).join(' ') : null;

      const methodMatches = method === routeMethod.toUpperCase();
      const pathMatches = url.includes(routePath);
      const bodyMatches =
        !routeBodyMatcher || bodyStr.includes(routeBodyMatcher);

      if (methodMatches && pathMatches && bodyMatches) {
        matchedResponse = response;
        break;
      }
    }

    const finalResponse = matchedResponse ?? { status: 200, json: {} };

    return {
      ok: finalResponse.status >= 200 && finalResponse.status < 300,
      status: finalResponse.status,
      headers: { get: () => null },
      json: async () => finalResponse.json,
      text: async () => JSON.stringify(finalResponse.json ?? ''),
    };
  };

  mockFn.calls = calls;
  return mockFn;
}

function createTestProvider(opts = {}) {
  return new GitHubProvider(
    {
      owner: 'test-owner',
      repo: 'test-repo',
      projectNumber: opts.projectNumber ?? null,
      operatorHandle: '@tester',
    },
    { token: 'test-token-123' },
  );
}

// ---------------------------------------------------------------------------
// Basic construction
// ---------------------------------------------------------------------------
describe('GitHubProvider — construction', () => {
  it('extends ITicketingProvider', () => {
    const provider = createTestProvider();
    assert.ok(provider instanceof ITicketingProvider);
  });

  it('stores config values', () => {
    const provider = createTestProvider({ projectNumber: 5 });
    assert.equal(provider.owner, 'test-owner');
    assert.equal(provider.repo, 'test-repo');
    assert.equal(provider.projectNumber, 5);
    assert.equal(provider.operatorHandle, '@tester');
  });

  it('uses provided token', () => {
    const provider = createTestProvider();
    assert.equal(provider.token, 'test-token-123');
  });
});

// ---------------------------------------------------------------------------
// getEpic
// ---------------------------------------------------------------------------
describe('GitHubProvider — getEpic()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns epic with parsed linked issues', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/10': {
        status: 200,
        json: {
          number: 10,
          title: 'Epic: Build v5',
          body: 'Goal description\n\nPRD: #11\nTech Spec: #12',
          labels: [{ name: 'type::epic' }],
        },
      },
    });

    const provider = createTestProvider();
    const epic = await provider.getEpic(10);

    assert.equal(epic.id, 10);
    assert.equal(epic.title, 'Epic: Build v5');
    assert.deepEqual(epic.labels, ['type::epic']);
    assert.deepEqual(epic.linkedIssues, { prd: 11, techSpec: 12 });
  });

  it('handles missing linked issues', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/10': {
        status: 200,
        json: {
          number: 10,
          title: 'Simple Epic',
          body: 'No linked docs here',
          labels: [],
        },
      },
    });

    const provider = createTestProvider();
    const epic = await provider.getEpic(10);
    assert.deepEqual(epic.linkedIssues, { prd: null, techSpec: null });
  });

  it('handles null body', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/10': {
        status: 200,
        json: { number: 10, title: 'No Body', body: null, labels: [] },
      },
    });

    const provider = createTestProvider();
    const epic = await provider.getEpic(10);
    assert.equal(epic.body, '');
    assert.deepEqual(epic.linkedIssues, { prd: null, techSpec: null });
  });

  it('throws on API error', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/999': { status: 404, json: { message: 'Not Found' } },
    });

    const provider = createTestProvider();
    await assert.rejects(provider.getEpic(999), /failed \(404\)/);
  });
});

// ---------------------------------------------------------------------------
// getTicket
// ---------------------------------------------------------------------------
describe('GitHubProvider — getTicket()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ticket with all metadata', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/42': {
        status: 200,
        json: {
          number: 42,
          title: 'Fix the thing',
          body: 'Detailed description',
          labels: [{ name: 'bug' }, { name: 'agent::ready' }],
          assignees: [{ login: 'alice' }, { login: 'bob' }],
          state: 'open',
        },
      },
    });

    const provider = createTestProvider();
    const ticket = await provider.getTicket(42);

    assert.equal(ticket.id, 42);
    assert.equal(ticket.title, 'Fix the thing');
    assert.deepEqual(ticket.labels, ['bug', 'agent::ready']);
    assert.deepEqual(ticket.assignees, ['alice', 'bob']);
    assert.equal(ticket.state, 'open');
  });
});

// ---------------------------------------------------------------------------
// getTicketDependencies
// ---------------------------------------------------------------------------
describe('GitHubProvider — getTicketDependencies()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses blocked by and blocks patterns', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/5': {
        status: 200,
        json: {
          number: 5,
          title: 'Dependent task',
          body: 'This is blocked by #3\nAlso depends on #4\nblocks #6',
          labels: [],
          assignees: [],
          state: 'open',
        },
      },
    });

    const provider = createTestProvider();
    const deps = await provider.getTicketDependencies(5);

    assert.deepEqual(deps.blockedBy, [3, 4]);
    assert.deepEqual(deps.blocks, [6]);
  });

  it('returns empty arrays when no dependencies', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/5': {
        status: 200,
        json: {
          number: 5,
          title: 'Independent task',
          body: 'No deps here',
          labels: [],
          assignees: [],
          state: 'open',
        },
      },
    });

    const provider = createTestProvider();
    const deps = await provider.getTicketDependencies(5);

    assert.deepEqual(deps.blockedBy, []);
    assert.deepEqual(deps.blocks, []);
  });
});

// ---------------------------------------------------------------------------
// createTicket
// ---------------------------------------------------------------------------
describe('GitHubProvider — createTicket()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates a ticket linked to the epic', async () => {
    const mockFetch = createRouteMock({
      'POST /issues': {
        status: 201,
        json: {
          number: 20,
          html_url: 'https://github.com/test-owner/test-repo/issues/20',
        },
      },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    const result = await provider.createTicket(10, {
      title: 'New task',
      body: 'Task description',
      labels: ['type::task'],
    });

    assert.equal(result.id, 20);
    assert.ok(result.url.includes('/issues/20'));

    // Verify the body includes the parent reference
    const sentBody = JSON.parse(mockFetch.calls[0].opts.body);
    assert.ok(sentBody.body.includes('parent: #10'));
  });

  it('includes dependency references in the body', async () => {
    const mockFetch = createRouteMock({
      'POST /issues': {
        status: 201,
        json: { number: 21, html_url: 'http://x' },
      },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    await provider.createTicket(10, {
      title: 'Dependent task',
      body: 'Depends on stuff',
      labels: [],
      dependencies: [5, 6],
    });

    const sentBody = JSON.parse(mockFetch.calls[0].opts.body);
    assert.ok(sentBody.body.includes('blocked by #5'));
    assert.ok(sentBody.body.includes('blocked by #6'));
  });
});

// ---------------------------------------------------------------------------
// updateTicket
// ---------------------------------------------------------------------------
describe('GitHubProvider — updateTicket()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('patches body and assignees', async () => {
    const mockFetch = createRouteMock({
      'PATCH /issues/42': { status: 200, json: {} },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    await provider.updateTicket(42, {
      body: 'Updated body',
      assignees: ['alice'],
    });

    assert.equal(mockFetch.calls.length, 1);
    const sentBody = JSON.parse(mockFetch.calls[0].opts.body);
    assert.equal(sentBody.body, 'Updated body');
    assert.deepEqual(sentBody.assignees, ['alice']);
  });

  it('adds and removes labels via separate API calls', async () => {
    const mockFetch = createRouteMock({
      'POST /labels': { status: 200, json: {} },
      'DELETE /labels/agent::ready': { status: 204, json: null },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    await provider.updateTicket(42, {
      labels: {
        add: ['agent::executing'],
        remove: ['agent::ready'],
      },
    });

    // Should have made 2 calls: add + remove
    assert.equal(mockFetch.calls.length, 2);
    assert.ok(mockFetch.calls[0].url.includes('/labels'));
    assert.equal(mockFetch.calls[0].opts.method, 'POST');
    assert.ok(mockFetch.calls[1].url.includes('/labels/'));
    assert.equal(mockFetch.calls[1].opts.method, 'DELETE');
  });
});

// ---------------------------------------------------------------------------
// postComment
// ---------------------------------------------------------------------------
describe('GitHubProvider — postComment()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('prepends type badge to comment body', async () => {
    const mockFetch = createRouteMock({
      'POST /comments': { status: 201, json: { id: 100 } },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    const result = await provider.postComment(42, {
      body: 'Unit tests pass',
      type: 'progress',
    });

    assert.equal(result.commentId, 100);
    const sentBody = JSON.parse(mockFetch.calls[0].opts.body);
    assert.ok(sentBody.body.includes('🔄 **Progress**'));
    assert.ok(sentBody.body.includes('Unit tests pass'));
  });
});

// ---------------------------------------------------------------------------
// createPullRequest
// ---------------------------------------------------------------------------
describe('GitHubProvider — createPullRequest()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates PR with Closes reference', async () => {
    const mockFetch = createRouteMock({
      'GET /issues/42': {
        status: 200,
        json: {
          number: 42,
          title: 'Fix the thing',
          body: '',
          labels: [],
          assignees: [],
          state: 'open',
        },
      },
      'POST /pulls': {
        status: 201,
        json: {
          number: 15,
          url: 'https://api.github.com/repos/test-owner/test-repo/pulls/15',
          html_url: 'https://github.com/test-owner/test-repo/pull/15',
        },
      },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    const result = await provider.createPullRequest('feature/fix-42', 42);

    assert.equal(result.number, 15);
    assert.ok(result.htmlUrl.includes('/pull/15'));

    // Verify the PR body links the issue
    const prBody = JSON.parse(mockFetch.calls[1].opts.body);
    assert.ok(prBody.body.includes('Closes #42'));
  });
});

// ---------------------------------------------------------------------------
// ensureLabels
// ---------------------------------------------------------------------------
describe('GitHubProvider — ensureLabels()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates missing labels and skips existing', async () => {
    const mockFetch = createRouteMock({
      'GET /labels': {
        status: 200,
        json: [
          { name: 'type::epic', color: '7057FF' },
          { name: 'bug', color: 'D93F0B' },
        ],
      },
      'POST /labels': { status: 201, json: { name: 'type::task' } },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    const result = await provider.ensureLabels([
      { name: 'type::epic', color: '#7057FF', description: 'Epic' },
      { name: 'type::task', color: '#7057FF', description: 'Task' },
    ]);

    assert.deepEqual(result.created, ['type::task']);
    assert.deepEqual(result.skipped, ['type::epic']);
  });

  it('strips # from color code when sending to API', async () => {
    const mockFetch = createRouteMock({
      'GET /labels': { status: 200, json: [] },
      'POST /labels': { status: 201, json: { name: 'new-label' } },
    });
    globalThis.fetch = mockFetch;

    const provider = createTestProvider();
    await provider.ensureLabels([
      { name: 'new-label', color: '#FF0000', description: '' },
    ]);

    const sentBody = JSON.parse(mockFetch.calls[1].opts.body);
    assert.equal(sentBody.color, 'FF0000'); // No # prefix
  });
});

// ---------------------------------------------------------------------------
// ensureProjectFields
// ---------------------------------------------------------------------------
describe('GitHubProvider — ensureProjectFields()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns empty results when projectNumber is null', async () => {
    const provider = createTestProvider({ projectNumber: null });
    const result = await provider.ensureProjectFields([
      { name: 'Sprint', type: 'iteration' },
    ]);
    assert.deepEqual(result, { created: [], skipped: [] });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe('GitHubProvider — error handling', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('includes status code in REST error messages', async () => {
    globalThis.fetch = createRouteMock({
      'GET /issues/1': { status: 403, json: { message: 'rate limited' } },
    });

    const provider = createTestProvider();
    await assert.rejects(provider.getTicket(1), /failed \(403\)/);
  });

  it('includes endpoint in REST error messages', async () => {
    // Use 422 (not retried by _fetchWithRetry) to ensure deterministic failure.
    globalThis.fetch = createRouteMock({
      'GET /issues/1': { status: 422, json: { message: 'validation failed' } },
    });

    const provider = createTestProvider();
    await assert.rejects(
      provider.getEpic(1),
      /\/repos\/test-owner\/test-repo\/issues\/1/,
    );
  });
});
