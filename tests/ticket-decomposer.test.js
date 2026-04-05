import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeEpic } from '../.agents/scripts/ticket-decomposer.js';

describe('ticket-decomposer orchestration', () => {
  let mockProvider;
  let mockLlm;

  beforeEach(() => {
    // Basic mock provider state setup
    mockProvider = {
      epicId: 1,
      createdTickets: [],
      updatedTickets: [],
      
      async getEpic(id) {
        if (id !== 1) return null;
        return {
          id: 1,
          title: 'Implement V5 Core',
          body: 'This epic covers the v5 architectural overhaul.',
          labels: ['epic'],
          linkedIssues: { prd: 100, techSpec: 101 }
        };
      },

      async getTicket(id) {
        if (id === 100) return { id: 100, body: 'Mocked PRD body' };
        if (id === 101) return { id: 101, body: 'Mocked Tech Spec body' };
        return null;
      },

      async createTicket(epicId, ticketData) {
        let newId = 200 + this.createdTickets.length;
        this.createdTickets.push({ epicId, ticketData, newId });
        return { id: newId, url: `https://github.com/test/${newId}` };
      },

      async updateTicket(id, mutations) {
        this.updatedTickets.push({ id, mutations });
      }
    };

    mockLlm = {
      promptsReceived: [],
      async generateText(systemPrompt, userPrompt) {
        this.promptsReceived.push({ systemPrompt, userPrompt });
        return JSON.stringify([
          {
            slug: 'f1',
            type: 'feature',
            title: 'Feature One',
            body: 'Body of Feature One',
            labels: ['type::feature', 'persona::engineer']
          },
          {
            slug: 's1',
            type: 'story',
            title: 'Story One',
            body: 'Body of Story One',
            labels: ['type::story', 'persona::fullstack'],
            depends_on: 'f1'
          },
          {
            slug: 't1',
            type: 'task',
            title: 'Task One',
            body: 'Body of Task One',
            labels: ['type::task', 'persona::engineer'],
            depends_on: 's1'
          }
        ]);
      }
    };
  });

  it('aborts early if epic is missing linked artifacts', async () => {
    // Override getEpic to return no links
    mockProvider.getEpic = async () => ({
      title: 'Missing Links Epic',
      linkedIssues: { prd: null, techSpec: null }
    });

    await assert.rejects(
      async () => await decomposeEpic(1, mockProvider, mockLlm),
      { message: '[Decomposer] Epic #1 is missing linked PRD or Tech Spec. Run the Epic Planner first.' }
    );
  });

  it('runs the full decomposition pipeline correctly', async () => {
    const config = {
      agentSettings: {
        riskGates: {
          heuristics: ['Destructive DB changes']
        }
      }
    };

    await decomposeEpic(1, mockProvider, mockLlm, config);

    // 1. LLM Generation checks
    assert.equal(mockLlm.promptsReceived.length, 1, 'Should call LLM once for decomposition');
    assert.ok(mockLlm.promptsReceived[0].systemPrompt.includes('### RISK HEURISTICS'), 'System prompt should include heuristics header');
    assert.ok(mockLlm.promptsReceived[0].systemPrompt.includes('Destructive DB changes'), 'System prompt should include specific heuristic');
    assert.ok(mockLlm.promptsReceived[0].userPrompt.includes('Mocked PRD body'), 'Prompt should include PRD body');
    assert.ok(mockLlm.promptsReceived[0].userPrompt.includes('Mocked Tech Spec body'), 'Prompt should include Tech Spec body');

    // 2. Ticket Creation checks
    assert.equal(mockProvider.createdTickets.length, 3, 'Should create exactly three tickets (Feature, Story, Task)');
    
    // Feature Ticket validation
    const f1 = mockProvider.createdTickets[0];
    assert.equal(f1.ticketData.title, 'Feature One');
    assert.deepEqual(f1.ticketData.labels, ['type::feature', 'persona::engineer']);
    assert.deepEqual(f1.ticketData.dependencies, [], 'Feature should have no dependencies (root in his tier)');

    // Story Ticket validation
    const s1 = mockProvider.createdTickets[1];
    assert.equal(s1.ticketData.title, 'Story One');
    assert.deepEqual(s1.ticketData.labels, ['type::story', 'persona::fullstack']);
    assert.deepEqual(s1.ticketData.dependencies, [200], 'Story should depend on its parent Feature (200)');

    // Task Ticket validation
    const t1 = mockProvider.createdTickets[2];
    assert.equal(t1.ticketData.title, 'Task One');
    assert.deepEqual(t1.ticketData.labels, ['type::task', 'persona::engineer']);
    assert.deepEqual(t1.ticketData.dependencies, [201], 'Task should depend on its parent Story (201)');
  });

  it('handles LLM markdown wrapping in JSON response', async () => {
    mockLlm.generateText = async () => '```json\n[{"slug":"f1","type":"feature","title":"Wrapped Feature","body":"Body","labels":[]}]\n```';
    
    await decomposeEpic(1, mockProvider, mockLlm);
    assert.equal(mockProvider.createdTickets.length, 1);
    assert.equal(mockProvider.createdTickets[0].ticketData.title, 'Wrapped Feature');
  });
});
