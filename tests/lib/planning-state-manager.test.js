import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanningStateManager } from '../../.agents/scripts/lib/orchestration/planning-state-manager.js';
import { MockProvider } from '../fixtures/mock-provider.js';

describe('PlanningStateManager', () => {
  it('heals dangling artifact references in the Epic object', async () => {
    const provider = new MockProvider({
      tickets: {
        10: {
          id: 10,
          title: 'Epic',
          body: 'Some description',
          labels: ['type::epic'],
        },
        11: {
          id: 11,
          title: '[PRD] Epic',
          body: 'parent: #10',
          labels: ['context::prd'],
          state: 'open',
        },
        12: {
          id: 12,
          title: '[Tech Spec] Epic',
          body: 'parent: #10',
          labels: ['context::tech-spec'],
          state: 'open',
        },
      },
    });

    const mgr = new PlanningStateManager(provider);
    const epic = {
      id: 10,
      title: 'Epic',
      body: 'Some description',
      linkedIssues: { prd: null, techSpec: null },
    };

    await mgr.healAndCleanupArtifacts(epic);

    // Should have filled linkedIssues from open tickets
    assert.strictEqual(epic.linkedIssues.prd, 11);
    assert.strictEqual(epic.linkedIssues.techSpec, 12);
  });

  it('closes redundant artifacts and detaches them', async () => {
    const provider = new MockProvider({
      tickets: {
        10: { id: 10, title: 'Epic', body: '', labels: ['type::epic'] },
        11: {
          id: 11,
          title: 'PRD 1',
          labels: ['context::prd'],
          state: 'open',
        },
        12: {
          id: 12,
          title: 'PRD 2',
          labels: ['context::prd'],
          state: 'open',
        },
      },
      subTickets: {
        10: [11, 12],
      },
    });

    const mgr = new PlanningStateManager(provider);
    const epic = {
      id: 10,
      title: 'Epic',
      body: '',
      linkedIssues: { prd: 11, techSpec: null },
    };

    // 12 is redundant because 11 is canonical
    await mgr.healAndCleanupArtifacts(epic);

    assert.strictEqual(provider.tickets[12].state, 'closed');
    assert.strictEqual(provider.tickets[11].state, 'open');
    // Redundant should be removed from subTickets
    assert.ok(!provider.subTickets[10].includes(12));
    assert.ok(provider.subTickets[10].includes(11));
  });

  it('force re-plan: closes all and strips body', async () => {
    const provider = new MockProvider({
      tickets: {
        10: {
          id: 10,
          title: 'Epic',
          body: 'Desc\n\n## Planning Artifacts\n- [ ] PRD: #11\n- [ ] Tech Spec: #12\n',
          labels: ['type::epic'],
        },
        11: { id: 11, labels: ['context::prd'], state: 'open' },
        12: { id: 12, labels: ['context::tech-spec'], state: 'open' },
      },
      subTickets: {
        10: [11, 12],
      },
    });

    const mgr = new PlanningStateManager(provider);
    const epic = {
      id: 10,
      title: 'Epic',
      body: provider.tickets[10].body,
      linkedIssues: { prd: 11, techSpec: 12 },
    };

    await mgr.healAndCleanupArtifacts(epic, true); // force=true

    assert.strictEqual(provider.tickets[11].state, 'closed');
    assert.strictEqual(provider.tickets[12].state, 'closed');
    assert.strictEqual(epic.linkedIssues.prd, null);
    assert.strictEqual(epic.linkedIssues.techSpec, null);
    assert.ok(!epic.body.includes('## Planning Artifacts'));
  });

  it('idempotently appends Planning Artifacts section to body', async () => {
    const provider = new MockProvider({
      tickets: {
        10: { id: 10, title: 'Epic', body: 'Base body', labels: ['type::epic'] },
      },
    });

    const mgr = new PlanningStateManager(provider);
    const epic = {
      id: 10,
      title: 'Epic',
      body: 'Base body',
      linkedIssues: { prd: 11, techSpec: 12 },
    };

    await mgr.healAndCleanupArtifacts(epic);

    assert.ok(epic.body.includes('## Planning Artifacts'));
    assert.ok(epic.body.includes('PRD: #11'));
    assert.ok(epic.body.includes('Tech Spec: #12'));

    const lastUpdate = provider.updates[provider.updates.length - 1];
    assert.strictEqual(lastUpdate.id, 10);
    assert.ok(lastUpdate.mutations.body.includes('## Planning Artifacts'));
  });
});
