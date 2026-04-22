import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeByLabels } from '../.agents/scripts/sprint-execute-router.js';

describe('sprint-execute-router.routeByLabels', () => {
  it('routes type::epic to epic mode', () => {
    const v = routeByLabels({
      id: 1,
      title: 'E',
      labels: ['type::epic', 'agent::ready'],
    });
    assert.equal(v.mode, 'epic');
    assert.equal(v.ticketId, 1);
    assert.match(v.reason, /type::epic/);
  });

  it('routes type::story to story mode', () => {
    const v = routeByLabels({ id: 2, title: 'S', labels: ['type::story'] });
    assert.equal(v.mode, 'story');
  });

  it('prefers type::epic over type::story if both present (defensive)', () => {
    const v = routeByLabels({
      id: 3,
      labels: ['type::story', 'type::epic'],
    });
    assert.equal(v.mode, 'epic');
  });

  it('rejects type::feature with a Feature-specific reason', () => {
    const v = routeByLabels({ id: 4, labels: ['type::feature'] });
    assert.equal(v.mode, 'reject');
    assert.match(v.reason, /Features are containers/i);
  });

  it('rejects type::task with a Task-specific reason', () => {
    const v = routeByLabels({ id: 5, labels: ['type::task'] });
    assert.equal(v.mode, 'reject');
    assert.match(v.reason, /children of Stories/i);
  });

  it('rejects tickets with no type:: label', () => {
    const v = routeByLabels({ id: 6, labels: ['agent::ready'] });
    assert.equal(v.mode, 'reject');
    assert.match(v.reason, /no recognized `type::`/);
  });

  it('handles missing labels array safely', () => {
    const v = routeByLabels({ id: 7 });
    assert.equal(v.mode, 'reject');
  });
});
