import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndNormalizeTickets } from '../.agents/scripts/lib/orchestration/ticket-validator.js';

test('ticket-validator: basic valid hierarchy', () => {
  const tickets = [
    { slug: 'F1', type: 'feature', title: 'Feature 1' },
    { slug: 'S1', type: 'story', title: 'Story 1', parent_slug: 'F1', labels: ['complexity::fast'] },
    { slug: 'T1', type: 'task', title: 'Task 1', parent_slug: 'S1' }
  ];

  const result = validateAndNormalizeTickets(tickets);
  assert.equal(result.length, 3);
});

test('ticket-validator: fails on missing types', () => {
  assert.throws(() => validateAndNormalizeTickets([{ slug: 'F1', type: 'feature' }]), /must contain at least one Story/);
});

test('ticket-validator: fails on missing parent', () => {
  const tickets = [
    { slug: 'F1', type: 'feature', title: 'Feature 1' },
    { slug: 'S1', type: 'story', title: 'Story 1', labels: ['complexity::fast'] }, // missing parent_slug
    { slug: 'T1', type: 'task', title: 'Task 1', parent_slug: 'S1' }
  ];
  assert.throws(() => validateAndNormalizeTickets(tickets), /must have a parent_slug/);
});

test('ticket-validator: fails on missing complexity', () => {
  const tickets = [
    { slug: 'F1', type: 'feature', title: 'Feature 1' },
    { slug: 'S1', type: 'story', title: 'Story 1', parent_slug: 'F1' }, // missing complexity
    { slug: 'T1', type: 'task', title: 'Task 1', parent_slug: 'S1' }
  ];
  assert.throws(() => validateAndNormalizeTickets(tickets), /missing a complexity label/);
});

test('ticket-validator: lifts cross-story dependencies', () => {
  const tickets = [
    { slug: 'F1', type: 'feature', title: 'Feature' },
    { slug: 'S1', type: 'story', title: 'Story 1', parent_slug: 'F1', labels: ['complexity::fast'] },
    { slug: 'S2', type: 'story', title: 'Story 2', parent_slug: 'F1', labels: ['complexity::fast'] },
    { slug: 'T1', type: 'task', title: 'Task 1', parent_slug: 'S1' },
    { slug: 'T2', type: 'task', title: 'Task 2', parent_slug: 'S2', depends_on: ['T1'] }
  ];

  const result = validateAndNormalizeTickets(tickets);
  const s2 = result.find(t => t.slug === 'S2');
  const t2 = result.find(t => t.slug === 'T2');

  assert.ok(s2.depends_on.includes('S1'), 'Story 2 should now depend on Story 1');
  assert.strictEqual(t2.depends_on.length, 0, 'Task 2 cross-story dependency should be removed from task level');
});

test('ticket-validator: detects cycles', () => {
  const tickets = [
    { slug: 'F1', type: 'feature', title: 'Feature' },
    { slug: 'S1', type: 'story', title: 'Story 1', parent_slug: 'F1', labels: ['complexity::fast'], depends_on: ['S2'] },
    { slug: 'S2', type: 'story', title: 'Story 2', parent_slug: 'F1', labels: ['complexity::fast'], depends_on: ['S1'] },
    { slug: 'T1', type: 'task', title: 'Task 1', parent_slug: 'S1' }
  ];

  assert.throws(() => validateAndNormalizeTickets(tickets), /Circular dependency detected/);
});
