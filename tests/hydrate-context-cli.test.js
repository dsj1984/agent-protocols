import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runHydrateContext,
  ticketToTask,
} from '../.agents/scripts/hydrate-context.js';
import {
  getEpicBranch,
  getStoryBranch,
} from '../.agents/scripts/lib/git-utils.js';
import { hydrateContext } from '../.agents/scripts/lib/orchestration/context-hydration-engine.js';

class MockProvider {
  constructor() {
    this.calls = [];
  }
  async getTicket(id) {
    this.calls.push(id);
    if (id === 99) {
      return {
        id: 99,
        title: 'Fix issue',
        body: '> Epic: #1 | Feature: #2\n\nFix the bug',
        labels: ['persona::engineer'],
      };
    }
    if (id === 100) {
      return {
        id: 100,
        title: 'Task on parent story',
        body: '> Epic: #1 | parent: #99\n\nFix the child task',
        labels: [],
      };
    }
    if (id === 1) return { id: 1, title: 'Epic', body: 'Epic Body' };
    if (id === 2) return { id: 2, title: 'Feature', body: 'Feature Body' };
    throw new Error(`Ticket #${id} not found`);
  }
}

test('ticketToTask: extracts persona from labels', () => {
  const task = ticketToTask({
    id: 5,
    title: 'T',
    body: 'b',
    labels: ['persona::reviewer', 'skill::audit-architecture', 'type::task'],
  });
  assert.equal(task.persona, 'reviewer');
  assert.deepEqual(task.skills, ['audit-architecture']);
});

test('runHydrateContext: emits the same { prompt } envelope as the MCP tool', async () => {
  const provider = new MockProvider();
  const envelope = await runHydrateContext({
    ticketId: 99,
    epicId: 1,
    provider,
  });
  assert.ok('prompt' in envelope, 'envelope has prompt key');
  assert.equal(Object.keys(envelope).length, 1, 'envelope has exactly one key');
  assert.equal(typeof envelope.prompt, 'string');
});

test('runHydrateContext: prompt matches direct SDK invocation byte-for-byte', async () => {
  const cliProvider = new MockProvider();
  const sdkProvider = new MockProvider();

  const { prompt: cliPrompt } = await runHydrateContext({
    ticketId: 99,
    epicId: 1,
    provider: cliProvider,
  });

  // Direct SDK call with the exact arguments the CLI assembles.
  const ticket = await sdkProvider.getTicket(99);
  const sdkPrompt = await hydrateContext(
    ticketToTask({ ...ticket, id: 99 }),
    sdkProvider,
    getEpicBranch(1),
    getStoryBranch(1, 99),
    1,
  );

  assert.equal(cliPrompt, sdkPrompt);
});

test('runHydrateContext: resolves epic id from body when --epic omitted', async () => {
  const provider = new MockProvider();
  const envelope = await runHydrateContext({ ticketId: 99, provider });
  assert.ok(envelope.prompt.includes('Fix the bug'));
});

test('runHydrateContext: resolves story branch from parent marker', async () => {
  const provider = new MockProvider();
  const envelope = await runHydrateContext({
    ticketId: 100,
    epicId: 1,
    provider,
  });
  assert.ok(envelope.prompt.includes('story-99'));
});

test('runHydrateContext: throws when epic cannot be resolved', async () => {
  const provider = {
    async getTicket(_id) {
      return {
        id: 50,
        title: 'No epic',
        body: 'no hierarchy here',
        labels: [],
      };
    },
  };
  await assert.rejects(
    runHydrateContext({ ticketId: 50, provider }),
    /Could not resolve epic id/,
  );
});
