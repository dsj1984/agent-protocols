/**
 * wire-dependencies.test.js — Story #5044
 *
 * Standalone audit Stories used to hardcode `depends_on: []` and express their
 * ordering as a prose `## Sequencing` block nothing could act on. What actually
 * kept a cohort off colliding branches was an accident — siblings shared the
 * sweep-wide audit provenance footers, and the delivery footprint guard scraped
 * path-shaped tokens out of them. Narrowing that scrape removes the accident,
 * so these tests pin the real serializer that replaces it: `blocked by #N` body
 * footers plus native `blocked_by` relations, both wired post-create.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wireAuditStoryEdges } from '../../.agents/scripts/lib/audit-to-stories/wire-dependencies.js';
import { parse as parseStoryBody } from '../../.agents/scripts/lib/story-body/story-body.js';

/** A minimal grouped-findings entry, shaped like `groupFindings` output. */
function group(groupKey, { file = `lib/${groupKey}.js` } = {}) {
  return {
    groupKey,
    title: `Remediate ${groupKey}`,
    files: [file],
    findings: [
      {
        title: `${groupKey} finding`,
        severity: 'medium',
        dimension: 'clean-code',
        recommendation: 'Do the thing.',
        agentPrompt: 'Do the thing.',
        sourceReport: 'temp/audits/audit-clean-code-results.md',
        files: [file],
        normalisedTitle: `${groupKey} finding`,
        fingerprint: { full: 'a'.repeat(40), short: 'aaaaaaaaaaaa' },
      },
    ],
  };
}

/**
 * A provider recording every body PATCH and every native dependency write.
 * `getDependencyWriteContext` / `getTicket` are the two ports
 * `applyBlockedByDependencies` needs; omitting them exercises the
 * footer-only degrade.
 */
function fakeProvider({ native = true } = {}) {
  const bodies = new Map();
  const nativeEdges = [];
  const provider = {
    updateTicket: (issueNumber, mutations) => {
      bodies.set(issueNumber, mutations.body);
      return Promise.resolve();
    },
  };
  if (native) {
    provider.getTicket = (issueNumber) =>
      Promise.resolve({ internalId: 900000 + issueNumber });
    provider.getDependencyWriteContext = () => ({
      owner: 'o',
      repo: 'r',
      gh: {
        api: ({ method, endpoint, body }) => {
          if (method === 'GET') return Promise.resolve([]);
          nativeEdges.push({ endpoint, body });
          return Promise.resolve({});
        },
      },
    });
  }
  return { provider, bodies, nativeEdges };
}

const wire = ({ groups, edges, issueByGroupKey, provider, bodies }) =>
  wireAuditStoryEdges({
    groups,
    edges,
    issueByGroupKey,
    provider,
    updateBody: (issueNumber, body) => {
      bodies.set(issueNumber, body);
      return Promise.resolve();
    },
  });

describe('wireAuditStoryEdges — declared ordering for a standalone audit cohort', () => {
  it('writes a blocked by #N footer AND a native blocked_by relation (AC-6)', async () => {
    const { provider, bodies, nativeEdges } = fakeProvider();
    const groups = [group('a'), group('b')];
    const summary = await wire({
      groups,
      edges: [{ fromGroupKey: 'b', toGroupKey: 'a' }],
      issueByGroupKey: { a: 101, b: 102 },
      provider,
      bodies,
    });

    // Half one: the canonical body footer, which is what /deliver's resolver
    // parses and the fallback when the dependencies API says no.
    assert.deepEqual(
      [...bodies.keys()],
      [102],
      'only the dependent is rewritten',
    );
    assert.deepEqual(parseStoryBody(bodies.get(102)).body.depends_on, ['#101']);
    assert.ok(bodies.get(102).includes('blocked by #101'));

    // Half two: the native relation, visible in the GitHub UI and readable
    // without parsing markdown.
    assert.equal(nativeEdges.length, 1);
    assert.match(
      nativeEdges[0].endpoint,
      /\/issues\/102\/dependencies\/blocked_by/,
    );
    assert.deepEqual(nativeEdges[0].body, { issue_id: 900101 });

    assert.deepEqual(summary, {
      storiesWired: 1,
      bodiesUpdated: 1,
      edgesDeclared: 1,
      native: { edgesAdded: 1, edgesSkipped: 0, edgesFailed: 0 },
    });
  });

  it('leaves an edge-free cohort completely alone', async () => {
    // An issue-body PATCH is a mutation and a notification. Rewriting every
    // Story of every sweep to an identical body would be noise.
    const { provider, bodies, nativeEdges } = fakeProvider();
    const summary = await wire({
      groups: [group('a'), group('b')],
      edges: [],
      issueByGroupKey: { a: 101, b: 102 },
      provider,
      bodies,
    });
    assert.equal(bodies.size, 0);
    assert.equal(nativeEdges.length, 0);
    assert.deepEqual(summary, {
      storiesWired: 0,
      bodiesUpdated: 0,
      edgesDeclared: 0,
      native: null,
    });
  });

  it('drops an edge whose target was never opened rather than guessing', async () => {
    const { provider, bodies } = fakeProvider();
    const summary = await wire({
      groups: [group('b')],
      edges: [{ fromGroupKey: 'b', toGroupKey: 'deduped-away' }],
      issueByGroupKey: { b: 102 },
      provider,
      bodies,
    });
    assert.equal(
      bodies.size,
      0,
      'no body claims a blocker that does not exist',
    );
    assert.equal(summary.edgesDeclared, 0);
  });

  it('keeps the footer when native mirroring is unavailable (non-fatal)', async () => {
    // Ordering must survive a provider with no dependencies API: the footer is
    // already written by the time mirroring runs, so a refusal costs
    // visibility, not ordering.
    const { provider, bodies } = fakeProvider({ native: false });
    const summary = await wire({
      groups: [group('a'), group('b')],
      edges: [{ fromGroupKey: 'b', toGroupKey: 'a' }],
      issueByGroupKey: { a: 101, b: 102 },
      provider,
      bodies,
    });
    assert.deepEqual(parseStoryBody(bodies.get(102)).body.depends_on, ['#101']);
    assert.equal(summary.native, null);
    assert.equal(summary.edgesDeclared, 1);
  });

  it('wires a chain, each Story naming only its own blocker', async () => {
    const { provider, bodies } = fakeProvider();
    await wire({
      groups: [group('a'), group('b'), group('c')],
      edges: [
        { fromGroupKey: 'b', toGroupKey: 'a' },
        { fromGroupKey: 'c', toGroupKey: 'b' },
      ],
      issueByGroupKey: { a: 101, b: 102, c: 103 },
      provider,
      bodies,
    });
    assert.deepEqual(parseStoryBody(bodies.get(102)).body.depends_on, ['#101']);
    assert.deepEqual(parseStoryBody(bodies.get(103)).body.depends_on, ['#102']);
    assert.equal(bodies.has(101), false, 'the root has no blocker');
  });
});
