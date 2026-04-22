/**
 * Tests for providers/github/ticket-mapper.js.
 *
 * Exercises the pure REST/GraphQL → ticket-shape translations that the
 * facade used to hold as methods on GitHubProvider.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const {
  issueToEpic,
  issueToEpicListItem,
  issueToListItem,
  issueToTicket,
  normalizeLabels,
  subIssueNodeToTicket,
} = await import(
  pathToFileURL(
    path.join(
      ROOT,
      '.agents',
      'scripts',
      'providers',
      'github',
      'ticket-mapper.js',
    ),
  ).href
);

describe('ticket-mapper — normalizeLabels', () => {
  it('returns [] for missing labels', () => {
    assert.deepEqual(normalizeLabels({}), []);
    assert.deepEqual(normalizeLabels({ labels: null }), []);
    assert.deepEqual(normalizeLabels(null), []);
  });

  it('maps REST-style { name } objects', () => {
    assert.deepEqual(
      normalizeLabels({ labels: [{ name: 'type::task' }, { name: 'a' }] }),
      ['type::task', 'a'],
    );
  });

  it('maps REST-style bare string labels', () => {
    assert.deepEqual(normalizeLabels({ labels: ['x', 'y'] }), ['x', 'y']);
  });

  it('maps GraphQL-style { nodes: [{ name }] }', () => {
    assert.deepEqual(
      normalizeLabels({
        labels: { nodes: [{ name: 'persona::architect' }] },
      }),
      ['persona::architect'],
    );
  });
});

describe('ticket-mapper — issueToTicket', () => {
  it('maps a REST Issue payload into the ticket shape', () => {
    const ticket = issueToTicket({
      number: 42,
      id: 9001,
      node_id: 'MDU6SXNzdWU=',
      title: 'Hello',
      body: 'World',
      labels: [{ name: 'type::task' }, { name: 'agent::ready' }],
      assignees: [{ login: 'alice' }, { login: 'bob' }],
      state: 'open',
    });
    assert.equal(ticket.id, 42);
    assert.equal(ticket.internalId, 9001);
    assert.equal(ticket.nodeId, 'MDU6SXNzdWU=');
    assert.equal(ticket.title, 'Hello');
    assert.equal(ticket.body, 'World');
    assert.deepEqual(ticket.labels, ['type::task', 'agent::ready']);
    assert.ok(ticket.labelSet instanceof Set);
    assert.ok(ticket.labelSet.has('type::task'));
    assert.deepEqual(ticket.assignees, ['alice', 'bob']);
    assert.equal(ticket.state, 'open');
  });

  it('coerces missing body to empty string', () => {
    const ticket = issueToTicket({ number: 1, labels: [] });
    assert.equal(ticket.body, '');
  });
});

describe('ticket-mapper — issueToEpic', () => {
  it('adds linkedIssues parsed from the body', () => {
    const epic = issueToEpic({
      number: 7,
      title: 'E',
      body: 'PRD: #10\nTech Spec: #11\n',
      labels: [{ name: 'type::epic' }],
    });
    assert.equal(epic.id, 7);
    assert.equal(epic.linkedIssues.prd, 10);
    assert.equal(epic.linkedIssues.techSpec, 11);
  });
});

describe('ticket-mapper — issueToListItem', () => {
  it('omits assignees (list shape)', () => {
    const item = issueToListItem({
      number: 5,
      id: 100,
      node_id: 'node',
      title: 'T',
      body: 'B',
      labels: [],
      assignees: [{ login: 'ignored' }],
      state: 'closed',
    });
    assert.equal(item.assignees, undefined);
    assert.equal(item.state, 'closed');
    assert.equal(item.title, 'T');
  });
});

describe('ticket-mapper — issueToEpicListItem', () => {
  it('preserves state_reason and omits body/nodeId', () => {
    const item = issueToEpicListItem({
      number: 1,
      title: 'e',
      labels: [],
      state: 'closed',
      state_reason: 'completed',
    });
    assert.equal(item.state_reason, 'completed');
    assert.equal(item.body, undefined);
    assert.equal(item.nodeId, undefined);
  });
});

describe('ticket-mapper — subIssueNodeToTicket', () => {
  it('lower-cases GraphQL state so REST and GraphQL round-trips agree', () => {
    const ticket = subIssueNodeToTicket({
      number: 99,
      databaseId: 1,
      id: 'node',
      title: 't',
      body: 'b',
      labels: { nodes: [{ name: 'a' }] },
      assignees: { nodes: [{ login: 'x' }] },
      state: 'OPEN',
    });
    assert.equal(ticket.state, 'open');
    assert.deepEqual(ticket.assignees, ['x']);
    assert.deepEqual(ticket.labels, ['a']);
    assert.equal(ticket.internalId, 1);
    assert.equal(ticket.nodeId, 'node');
  });

  it('handles missing body and assignees gracefully', () => {
    const ticket = subIssueNodeToTicket({
      number: 99,
      databaseId: 1,
      id: 'node',
      title: 't',
      labels: { nodes: [] },
      state: 'closed',
    });
    assert.equal(ticket.body, '');
    assert.deepEqual(ticket.assignees, []);
  });
});
