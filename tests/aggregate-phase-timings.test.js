import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregate,
  collectSummaries,
  findPhaseTimingsInComments,
  parsePhaseTimingsBody,
  percentile,
  recommendCaps,
  renderSummary,
  runAggregator,
} from '../.agents/scripts/aggregate-phase-timings.js';

function phaseTimingsBody(storyId, phases, totalMs = 0) {
  const payload = {
    kind: 'phase-timings',
    storyId,
    totalMs,
    phases,
  };
  return `### Phase timings — story #${storyId}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
}

function makeProvider({ tickets = new Map(), comments = new Map() } = {}) {
  return {
    async getSubTickets(epicId) {
      const children = tickets.get(epicId);
      if (!children) return [];
      return children;
    },
    async getTicketComments(ticketId) {
      const list = comments.get(ticketId);
      if (list instanceof Error) throw list;
      return list ?? [];
    },
    async getTicket() {
      return null;
    },
  };
}

describe('parsePhaseTimingsBody', () => {
  it('parses a well-formed phase-timings comment', () => {
    const body = phaseTimingsBody(123, [
      { name: 'worktree-create', elapsedMs: 1200 },
      { name: 'install', elapsedMs: 8400 },
    ]);
    const parsed = parsePhaseTimingsBody(body);
    assert.equal(parsed.storyId, 123);
    assert.equal(parsed.phases.length, 2);
    assert.deepEqual(parsed.phases[0], {
      name: 'worktree-create',
      elapsedMs: 1200,
    });
  });

  it('drops phases with non-numeric elapsedMs', () => {
    const body =
      '```json\n' +
      JSON.stringify({
        kind: 'phase-timings',
        storyId: 9,
        totalMs: 0,
        phases: [
          { name: 'install', elapsedMs: 'not-a-number' },
          { name: 'test', elapsedMs: 100 },
        ],
      }) +
      '\n```';
    const parsed = parsePhaseTimingsBody(body);
    assert.equal(parsed.phases.length, 1);
    assert.equal(parsed.phases[0].name, 'test');
  });

  it('returns null for malformed JSON', () => {
    const body = '```json\n{not valid}\n```';
    assert.equal(parsePhaseTimingsBody(body), null);
  });

  it('returns null when no fenced JSON block is present', () => {
    assert.equal(parsePhaseTimingsBody('no fenced block here'), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(parsePhaseTimingsBody(null), null);
    assert.equal(parsePhaseTimingsBody(undefined), null);
    assert.equal(parsePhaseTimingsBody(42), null);
  });
});

describe('findPhaseTimingsInComments', () => {
  it('finds a comment by kind marker in fenced JSON (no HTML marker)', () => {
    const comments = [
      { id: 1, body: 'boring' },
      { id: 2, body: phaseTimingsBody(10, [{ name: 'test', elapsedMs: 1 }]) },
      { id: 3, body: 'also boring' },
    ];
    const found = findPhaseTimingsInComments(comments);
    assert.equal(found?.id, 2);
  });

  it('finds a comment by HTML structured marker', () => {
    const comments = [
      {
        id: 7,
        body: '<!-- structured:phase-timings -->\n```json\n{"kind":"phase-timings","storyId":1,"totalMs":0,"phases":[]}\n```',
      },
    ];
    assert.equal(findPhaseTimingsInComments(comments)?.id, 7);
  });

  it('returns null when no comment matches', () => {
    assert.equal(
      findPhaseTimingsInComments([{ id: 1, body: 'nothing' }]),
      null,
    );
  });

  it('returns null on non-array input', () => {
    assert.equal(findPhaseTimingsInComments(null), null);
    assert.equal(findPhaseTimingsInComments({}), null);
  });
});

describe('percentile', () => {
  it('returns 0 for empty samples', () => {
    assert.equal(percentile([], 0.5), 0);
  });

  it('computes p50 and p95 by nearest-rank', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(percentile(samples, 0.5), 50);
    assert.equal(percentile(samples, 0.95), 100);
  });

  it('clamps q=1 to the last element', () => {
    assert.equal(percentile([1, 2, 3], 1), 3);
  });

  it('does not mutate input', () => {
    const samples = [3, 1, 2];
    percentile(samples, 0.5);
    assert.deepEqual(samples, [3, 1, 2]);
  });
});

describe('aggregate', () => {
  it('buckets samples by phase and preserves canonical order', () => {
    const summaries = [
      {
        storyId: 1,
        totalMs: 0,
        phases: [
          { name: 'test', elapsedMs: 100 },
          { name: 'worktree-create', elapsedMs: 50 },
        ],
      },
      {
        storyId: 2,
        totalMs: 0,
        phases: [
          { name: 'worktree-create', elapsedMs: 80 },
          { name: 'test', elapsedMs: 200 },
        ],
      },
    ];
    const { rows, sampleCount } = aggregate(summaries);
    assert.equal(sampleCount, 2);
    // worktree-create comes before test in PHASE_ORDER.
    assert.equal(rows[0].name, 'worktree-create');
    assert.equal(rows[1].name, 'test');
    assert.equal(rows[0].n, 2);
    assert.equal(rows[1].n, 2);
  });

  it('appends unknown phase names at the tail', () => {
    const summaries = [
      {
        storyId: 1,
        totalMs: 0,
        phases: [
          { name: 'install', elapsedMs: 100 },
          { name: 'unknown-phase', elapsedMs: 50 },
        ],
      },
    ];
    const { rows } = aggregate(summaries);
    const names = rows.map((r) => r.name);
    assert.ok(names.includes('install'));
    assert.ok(names.includes('unknown-phase'));
    assert.equal(names.at(-1), 'unknown-phase');
  });

  it('handles empty summaries', () => {
    const { rows, sampleCount } = aggregate([]);
    assert.equal(rows.length, 0);
    assert.equal(sampleCount, 0);
  });

  it('skips summaries with no phases array', () => {
    const { rows, sampleCount } = aggregate([
      null,
      undefined,
      { storyId: 1, phases: null },
      { storyId: 2, totalMs: 0, phases: [{ name: 'test', elapsedMs: 5 }] },
    ]);
    assert.equal(sampleCount, 1);
    assert.equal(rows.length, 1);
  });
});

describe('recommendCaps', () => {
  it('returns defaults matching v5.21.0 constants at low sample counts', () => {
    assert.deepEqual(recommendCaps({ sampleCount: 3 }), {
      waveGate: 0,
      commitAssertion: 4,
      progressReporter: 8,
    });
  });

  it('switches waveGate to 16 at sample count >= 50', () => {
    assert.equal(recommendCaps({ sampleCount: 50 }).waveGate, 16);
    assert.equal(recommendCaps({ sampleCount: 200 }).waveGate, 16);
  });
});

describe('renderSummary', () => {
  it('produces a markdown summary with the per-phase table and recommended caps', () => {
    const md = renderSummary({
      rows: [{ name: 'install', p50: 3000, p95: 10000, n: 5 }],
      sampleCount: 5,
      epicIds: [553],
      epicSampleCounts: new Map([[553, 5]]),
      caps: { waveGate: 0, commitAssertion: 4, progressReporter: 8 },
      generatedAt: '2026-04-24T00:00:00.000Z',
    });
    assert.match(md, /# Phase-timings aggregate/);
    assert.match(md, /#553 \(5\)/);
    assert.match(md, /\| install \|/);
    assert.match(md, /Recommended `orchestration.concurrency`/);
    assert.match(md, /\| waveGate \| 0 \|/);
  });

  it('flags synthetic runs in the header', () => {
    const md = renderSummary({
      rows: [],
      sampleCount: 0,
      epicIds: [],
      epicSampleCounts: new Map(),
      caps: { waveGate: 0, commitAssertion: 4, progressReporter: 8 },
      synthetic: true,
      generatedAt: '2026-04-24T00:00:00.000Z',
    });
    assert.match(md, /SYNTHETIC/);
  });

  it('renders an empty-sample notice when rows is empty', () => {
    const md = renderSummary({
      rows: [],
      sampleCount: 0,
      epicIds: [553],
      epicSampleCounts: new Map([[553, 0]]),
      caps: { waveGate: 0, commitAssertion: 4, progressReporter: 8 },
      generatedAt: 'X',
    });
    assert.match(md, /_No phase-timings samples found\._/);
  });
});

describe('collectSummaries', () => {
  it('finds phase-timings across multiple epics and their children', async () => {
    const tickets = new Map([
      [553, [{ id: 401 }, { id: 402 }]],
      [600, [{ id: 501 }]],
    ]);
    const commentMap = new Map([
      [
        401,
        [
          { id: 1, body: 'unrelated' },
          {
            id: 2,
            body: phaseTimingsBody(401, [{ name: 'install', elapsedMs: 5000 }]),
          },
        ],
      ],
      [402, [{ id: 3, body: 'no timing here' }]],
      [
        501,
        [
          {
            id: 4,
            body: phaseTimingsBody(501, [
              { name: 'install', elapsedMs: 10000 },
              { name: 'test', elapsedMs: 20000 },
            ]),
          },
        ],
      ],
    ]);
    const warnings = [];
    const { summaries, epicSampleCounts, errors } = await collectSummaries(
      [553, 600],
      {
        provider: makeProvider({ tickets, comments: commentMap }),
        logger: { warn: (m) => warnings.push(m) },
      },
    );
    assert.equal(summaries.length, 2);
    assert.equal(epicSampleCounts.get(553), 1);
    assert.equal(epicSampleCounts.get(600), 1);
    assert.equal(errors.length, 0);
  });

  it('warns and continues when an Epic yields zero phase-timings', async () => {
    const tickets = new Map([[777, [{ id: 900 }]]]);
    const commentMap = new Map([[900, [{ id: 1, body: 'nothing here' }]]]);
    const warnings = [];
    const { summaries, epicSampleCounts } = await collectSummaries([777], {
      provider: makeProvider({ tickets, comments: commentMap }),
      logger: { warn: (m) => warnings.push(m) },
    });
    assert.equal(summaries.length, 0);
    assert.equal(epicSampleCounts.get(777), 0);
    assert.ok(
      warnings.some((m) => m.includes('Epic #777')),
      'expected a warning mentioning the empty Epic',
    );
  });

  it('captures errors when getSubTickets throws', async () => {
    const broken = {
      async getSubTickets() {
        throw new Error('rate limited');
      },
      async getTicketComments() {
        return [];
      },
    };
    const warnings = [];
    const { summaries, errors } = await collectSummaries([1, 2], {
      provider: broken,
      logger: { warn: (m) => warnings.push(m) },
    });
    assert.equal(summaries.length, 0);
    assert.equal(errors.length, 2);
    assert.match(errors[0].error, /rate limited/);
    assert.ok(
      warnings.every((m) => m.includes('getSubTickets failed')),
      'expected warnings to mention getSubTickets',
    );
  });

  it('skips a single child whose getTicketComments fails, without halting', async () => {
    const tickets = new Map([[100, [{ id: 201 }, { id: 202 }]]]);
    const commentMap = new Map([
      [201, new Error('transient')],
      [
        202,
        [
          {
            id: 1,
            body: phaseTimingsBody(202, [{ name: 'test', elapsedMs: 1000 }]),
          },
        ],
      ],
    ]);
    const warnings = [];
    const { summaries } = await collectSummaries([100], {
      provider: makeProvider({ tickets, comments: commentMap }),
      logger: { warn: (m) => warnings.push(m) },
    });
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].storyId, 202);
    assert.ok(
      warnings.some((m) => m.includes('Story #201')),
      'expected a per-story warning for the failing comment fetch',
    );
  });
});

describe('runAggregator (end-to-end)', () => {
  it('returns markdown + rows + caps for a realistic provider', async () => {
    const tickets = new Map([[553, [{ id: 401 }, { id: 402 }, { id: 403 }]]]);
    const commentMap = new Map([
      [
        401,
        [
          {
            id: 1,
            body: phaseTimingsBody(401, [{ name: 'install', elapsedMs: 1000 }]),
          },
        ],
      ],
      [
        402,
        [
          {
            id: 2,
            body: phaseTimingsBody(402, [{ name: 'install', elapsedMs: 2000 }]),
          },
        ],
      ],
      [
        403,
        [
          {
            id: 3,
            body: phaseTimingsBody(403, [
              { name: 'install', elapsedMs: 10000 },
            ]),
          },
        ],
      ],
    ]);
    const result = await runAggregator({
      epicIds: [553],
      provider: makeProvider({ tickets, comments: commentMap }),
      now: () => new Date('2026-04-24T00:00:00.000Z'),
    });
    assert.equal(result.sampleCount, 3);
    assert.equal(result.rows[0].name, 'install');
    assert.equal(result.rows[0].p50, 2000);
    assert.equal(result.rows[0].p95, 10000);
    assert.match(result.markdown, /Phase-timings aggregate/);
    // Below the 50-sample threshold the recommended waveGate is 0 (uncapped).
    assert.equal(result.caps.waveGate, 0);
  });

  it('throws on empty epicIds', async () => {
    await assert.rejects(
      () =>
        runAggregator({
          epicIds: [],
          provider: makeProvider(),
        }),
      /non-empty epicIds/,
    );
  });

  it('throws on missing provider', async () => {
    await assert.rejects(
      () => runAggregator({ epicIds: [1] }),
      /requires a provider/,
    );
  });
});
