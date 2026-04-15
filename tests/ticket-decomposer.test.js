import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DECOMPOSER_SYSTEM_PROMPT } from '../.agents/scripts/lib/templates/decomposer-prompts.js';
import {
  buildDecomposerSystemPrompt,
  buildDecompositionContext,
  decomposeEpic,
} from '../.agents/scripts/ticket-decomposer.js';

const baseTickets = () => [
  {
    slug: 'f1',
    type: 'feature',
    title: 'Feature One',
    body: 'Body of Feature One',
    labels: ['type::feature', 'persona::engineer'],
  },
  {
    slug: 's1',
    type: 'story',
    title: 'Story One',
    body: 'Body of Story One',
    labels: ['type::story', 'persona::fullstack', 'complexity::fast'],
    parent_slug: 'f1',
  },
  {
    slug: 't1',
    type: 'task',
    title: 'Task One',
    body: 'Body of Task One',
    labels: ['type::task', 'persona::engineer'],
    parent_slug: 's1',
  },
];

describe('ticket-decomposer orchestration (v5.6+)', () => {
  let mockProvider;

  beforeEach(() => {
    mockProvider = {
      createdTickets: [],
      updatedTickets: [],

      async getEpic(id) {
        if (id !== 1) return null;
        return {
          id: 1,
          title: 'Implement V5 Core',
          body: 'Epic body.',
          labels: ['epic'],
          linkedIssues: { prd: 100, techSpec: 101 },
        };
      },

      async getTicket(id) {
        if (id === 100) return { id: 100, body: 'Mocked PRD body' };
        if (id === 101) return { id: 101, body: 'Mocked Tech Spec body' };
        return null;
      },

      async createTicket(epicId, ticketData) {
        const newId = 200 + this.createdTickets.length;
        this.createdTickets.push({ epicId, ticketData, newId });
        return { id: newId, url: `https://github.com/test/${newId}` };
      },

      async updateTicket(id, mutations) {
        this.updatedTickets.push({ id, mutations });
      },
    };
  });

  it('aborts early if epic is missing linked artifacts', async () => {
    mockProvider.getEpic = async () => ({
      title: 'Missing Links Epic',
      linkedIssues: { prd: null, techSpec: null },
    });

    await assert.rejects(
      async () =>
        await decomposeEpic(1, mockProvider, { tickets: baseTickets() }),
      {
        message:
          '[Decomposer] Epic #1 is missing linked PRD or Tech Spec. Run the Epic Planner first.',
      },
    );
  });

  it('rejects a non-array tickets payload', async () => {
    await assert.rejects(
      async () =>
        await decomposeEpic(1, mockProvider, { tickets: 'not an array' }),
      { message: /tickets must be an array/ },
    );
  });

  it('creates Feature/Story/Task tickets from an authored array', async () => {
    await decomposeEpic(1, mockProvider, { tickets: baseTickets() });

    assert.equal(
      mockProvider.createdTickets.length,
      3,
      'Should create exactly three tickets (Feature, Story, Task)',
    );

    const f1 = mockProvider.createdTickets[0];
    assert.equal(f1.ticketData.title, 'Feature One');
    assert.deepEqual(f1.ticketData.labels, [
      'type::feature',
      'persona::engineer',
    ]);
    assert.deepEqual(f1.ticketData.dependencies, []);

    const s1 = mockProvider.createdTickets[1];
    assert.equal(s1.ticketData.title, 'Story One');
    assert.deepEqual(s1.ticketData.labels, [
      'type::story',
      'persona::fullstack',
      'complexity::fast',
    ]);

    const t1 = mockProvider.createdTickets[2];
    assert.equal(t1.ticketData.title, 'Task One');
  });

  it('maps depends_on slugs to created issue IDs', async () => {
    const tickets = baseTickets();
    tickets.push({
      slug: 't2',
      type: 'task',
      title: 'Task Two',
      body: 'Depends on Task One',
      labels: ['type::task', 'persona::engineer'],
      parent_slug: 's1',
      depends_on: ['t1'],
    });

    await decomposeEpic(1, mockProvider, { tickets });

    const t2 = mockProvider.createdTickets.find(
      (c) => c.ticketData.title === 'Task Two',
    );
    assert.ok(t2);
    // t1 is the third created ticket → id 202
    assert.deepEqual(t2.ticketData.dependencies, [202]);
  });
});

describe('ticket-decomposer buildDecomposerSystemPrompt', () => {
  it('returns the base prompt when no heuristics are supplied', () => {
    const prompt = buildDecomposerSystemPrompt([]);
    assert.equal(prompt, DECOMPOSER_SYSTEM_PROMPT);
  });

  it('appends risk heuristics when supplied', () => {
    const prompt = buildDecomposerSystemPrompt([
      'Destructive DB changes',
      'Global refactors',
    ]);
    assert.ok(prompt.startsWith(DECOMPOSER_SYSTEM_PROMPT));
    assert.ok(prompt.includes('### RISK HEURISTICS'));
    assert.ok(prompt.includes('Destructive DB changes'));
    assert.ok(prompt.includes('Global refactors'));
  });
});

describe('ticket-decomposer buildDecompositionContext', () => {
  it('returns the PRD/Tech Spec bodies and system prompt', async () => {
    const provider = {
      async getEpic(id) {
        return {
          id,
          title: 'Ctx Epic',
          linkedIssues: { prd: 10, techSpec: 11 },
        };
      },
      async getTicket(id) {
        return {
          id,
          body: id === 10 ? 'PRD BODY' : 'TECH SPEC BODY',
        };
      },
    };

    const ctx = await buildDecompositionContext(1, provider, {
      agentSettings: { riskGates: { heuristics: ['Heuristic A'] } },
    });

    assert.equal(ctx.epic.id, 1);
    assert.equal(ctx.prd.body, 'PRD BODY');
    assert.equal(ctx.techSpec.body, 'TECH SPEC BODY');
    assert.deepEqual(ctx.heuristics, ['Heuristic A']);
    assert.ok(ctx.systemPrompt.includes('Heuristic A'));
    assert.equal(ctx.maxTickets, 25);
  });

  it('throws when planning artifacts are missing', async () => {
    const provider = {
      async getEpic() {
        return { id: 1, linkedIssues: { prd: null, techSpec: null } };
      },
      async getTicket() {
        return null;
      },
    };
    await assert.rejects(
      async () => await buildDecompositionContext(1, provider, {}),
      { message: /missing linked PRD or Tech Spec/ },
    );
  });
});
