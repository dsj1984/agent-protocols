import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { planEpic } from '../.agents/scripts/epic-planner.js';

describe('epic-planner orchestration', () => {
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
          linkedIssues: { prd: null, techSpec: null },
        };
      },

      async createTicket(epicId, ticketData) {
        const newId = 100 + this.createdTickets.length;
        this.createdTickets.push({ epicId, ticketData, newId });
        return { id: newId, url: `https://github.com/test/${newId}` };
      },

      async updateTicket(id, mutations) {
        this.updatedTickets.push({ id, mutations });
      },

      async getTickets(_epicId, _opts) {
        return []; // No existing tickets by default
      },

      async postComment(_id, _comment) {
        // No-op for tests
      },
    };

    mockLlm = {
      promptsReceived: [],
      async generateText(systemPrompt, userPrompt) {
        this.promptsReceived.push({ systemPrompt, userPrompt });
        if (systemPrompt.includes('Product Requirements Document')) {
          return '## Overview\nThis is a mocked PRD content.';
        }
        if (systemPrompt.includes('Technical Specification')) {
          return '## Technical Overview\nThis is a mocked Tech Spec content.';
        }
        return 'Unknown content';
      },
    };
  });

  it('aborts early if epic cannot be found', async () => {
    await assert.rejects(
      async () => await planEpic(999, mockProvider, mockLlm),
      { message: 'Epic #999 not found.' },
    );
  });

  it('aborts early if epic already has BOTH linked issues', async () => {
    // M-8: Only abort if BOTH PRD and Tech Spec exist
    mockProvider.getEpic = async () => ({
      id: 1,
      title: 'Fully Linked Epic',
      body: '',
      linkedIssues: { prd: 42, techSpec: 43 },
    });

    await planEpic(1, mockProvider, mockLlm);

    assert.equal(
      mockProvider.createdTickets.length,
      0,
      'No tickets should be created if both already linked.',
    );
    assert.equal(
      mockLlm.promptsReceived.length,
      0,
      'No LLM calls should happen.',
    );
  });

  it('resumes from existing PRD when only Tech Spec is missing', async () => {
    // M-8: Resume from existing PRD
    mockProvider.getEpic = async () => ({
      id: 1,
      title: 'Partial Epic',
      body: '',
      linkedIssues: { prd: 42, techSpec: null },
    });
    mockProvider.getTicket = async (id) => ({
      id,
      body: '## Overview\nExisting PRD content from ticket #42.',
    });

    await planEpic(1, mockProvider, mockLlm);

    // Only Tech Spec should be created (PRD reused)
    assert.equal(
      mockProvider.createdTickets.length,
      1,
      'Should create only the Tech Spec.',
    );
    assert.equal(
      mockProvider.createdTickets[0].ticketData.title,
      '[Tech Spec] Partial Epic',
    );
    // LLM called only once (Tech Spec generation)
    assert.equal(
      mockLlm.promptsReceived.length,
      1,
      'Should call LLM once for Tech Spec only.',
    );
  });

  it('runs the full planning pipeline correctly', async () => {
    await planEpic(1, mockProvider, mockLlm);

    // 1. LLM Generation checks
    assert.equal(
      mockLlm.promptsReceived.length,
      2,
      'Should call LLM twice (PRD, then Tech Spec)',
    );
    assert.ok(
      mockLlm.promptsReceived[0].userPrompt.includes(
        'v5 architectural overhaul',
      ),
      'PRD prompt should include Epic body',
    );
    assert.ok(
      mockLlm.promptsReceived[1].userPrompt.includes('mocked PRD content'),
      'Tech Spec prompt should include generated PRD body',
    );

    // 2. Ticket Creation checks
    assert.equal(
      mockProvider.createdTickets.length,
      2,
      'Should create exactly two tickets',
    );

    // PRD Ticket validation
    const prdCreation = mockProvider.createdTickets[0];
    assert.equal(prdCreation.epicId, 1);
    assert.equal(prdCreation.ticketData.title, '[PRD] Implement V5 Core');
    assert.deepEqual(prdCreation.ticketData.labels, ['context::prd']);
    assert.deepEqual(prdCreation.ticketData.dependencies, []); // No deps, epic is parent

    // Tech Spec Ticket validation
    const tsCreation = mockProvider.createdTickets[1];
    assert.equal(tsCreation.epicId, 1);
    assert.equal(tsCreation.ticketData.title, '[Tech Spec] Implement V5 Core');
    assert.deepEqual(tsCreation.ticketData.labels, ['context::tech-spec']);
    assert.deepEqual(
      tsCreation.ticketData.dependencies,
      [100],
      'Tech spec should depend on the newly created PRD issue',
    );

    // 3. Epic Update checks
    assert.equal(
      mockProvider.updatedTickets.length,
      1,
      'Should update the epic once',
    );
    const update = mockProvider.updatedTickets[0];
    assert.equal(update.id, 1);
    assert.ok(
      update.mutations.body.includes('- [ ] PRD: #100'),
      'Epic body should contain PRD checklist item',
    );
    assert.ok(
      update.mutations.body.includes('- [ ] Tech Spec: #101'),
      'Epic body should contain Tech Spec checklist item',
    );
  });
});
