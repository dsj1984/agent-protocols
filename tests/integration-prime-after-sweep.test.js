/**
 * Integration: after a `getTickets(epicId)` sweep followed by
 * `primeTicketCache`, subsequent `getTicket(childId)` calls must issue 0
 * additional HTTP requests. Protects the perf invariant behind story #561.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitHubProvider } from '../.agents/scripts/providers/github.js';
import { fetchTasks } from '../.agents/scripts/lib/orchestration/task-fetcher.js';

process.env.GITHUB_TOKEN = 'mock-token';

function makeIssue(number, extraLabels = []) {
  return {
    number,
    id: 10_000 + number,
    node_id: `N_${number}`,
    title: `Issue ${number}`,
    body: `Epic: #10\n`,
    labels: [{ name: 'type::task' }, ...extraLabels.map((n) => ({ name: n }))],
    assignees: [],
    state: 'open',
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => '',
  };
}

describe('integration: primeTicketCache after getTickets sweep', () => {
  it('GitHubProvider direct: 10 getTicket reads after sweep → 0 extra HTTP calls', async () => {
    const issues = Array.from({ length: 10 }, (_, i) => makeIssue(100 + i));
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/issues?')) {
        return jsonResponse(issues);
      }
      throw new Error(`unexpected fetch to ${url}`);
    };

    const provider = new GitHubProvider(
      { owner: 'o', repo: 'r' },
      { fetchImpl, token: 'mock-token' },
    );

    const sweep = await provider.getTickets(10);
    assert.equal(sweep.length, 10);

    const afterSweep = calls.length;
    provider.primeTicketCache(sweep);

    for (const t of sweep) {
      const hit = await provider.getTicket(t.id);
      assert.equal(hit.id, t.id);
    }

    assert.equal(
      calls.length - afterSweep,
      0,
      `expected 0 extra HTTP calls after sweep+prime, got ${calls.length - afterSweep}`,
    );
  });

  it('fetchTasks path: getTicket loop for sweep children → 0 extra HTTP calls', async () => {
    const issues = Array.from({ length: 10 }, (_, i) => makeIssue(200 + i));
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/issues?')) {
        return jsonResponse(issues);
      }
      throw new Error(`unexpected fetch to ${url}`);
    };

    const provider = new GitHubProvider(
      { owner: 'o', repo: 'r' },
      { fetchImpl, token: 'mock-token' },
    );

    const tasks = await fetchTasks(provider, 10);
    assert.equal(tasks.length, 10);

    const afterSweep = calls.length;
    for (const t of tasks) {
      const hit = await provider.getTicket(t.id);
      assert.equal(hit.id, t.id);
    }

    assert.equal(
      calls.length - afterSweep,
      0,
      `expected 0 extra HTTP calls after fetchTasks() sweep, got ${calls.length - afterSweep}`,
    );
  });
});
