import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  EPIC_RUN_PROGRESS_TYPE,
  ProgressReporter,
} from '../../.agents/scripts/lib/orchestration/epic-runner/progress-reporter.js';

function buildProvider(tickets = {}, comments = []) {
  return {
    async getTicket(id) {
      return tickets[id] ?? null;
    },
    async getTicketComments() {
      return comments;
    },
    async listComments() {
      return comments;
    },
    async postComment(_ticketId, { body }) {
      comments.push({ id: `new-${comments.length}`, body });
      return { id: `new-${comments.length - 1}` };
    },
    async updateComment(commentId, { body }) {
      const target = comments.find((c) => c.id === commentId);
      if (target) target.body = body;
      return target ?? { id: commentId };
    },
  };
}

function silentLogger() {
  const calls = { info: [], warn: [] };
  return {
    log: calls,
    info: (m) => calls.info.push(m),
    warn: (m) => calls.warn.push(m),
  };
}

describe('ProgressReporter', () => {
  it('is disabled when intervalSec <= 0', () => {
    const reporter = new ProgressReporter({
      provider: buildProvider(),
      epicId: 1,
      intervalSec: 0,
    });
    assert.equal(reporter.isEnabled(), false);
    reporter.start();
    assert.equal(reporter.timer, null);
  });

  it('rejects missing provider or non-numeric epicId', () => {
    assert.throws(
      () => new ProgressReporter({ epicId: 1 }),
      /requires a provider/,
    );
    assert.throws(
      () => new ProgressReporter({ provider: buildProvider() }),
      /requires a numeric epicId/,
    );
  });

  it('renders a table with the correct state emoji and done-count', async () => {
    const provider = buildProvider({
      10: { number: 10, title: 'A', state: 'CLOSED', labels: [] },
      11: {
        number: 11,
        title: 'B',
        state: 'OPEN',
        labels: ['agent::executing'],
      },
      12: { number: 12, title: 'C', state: 'OPEN', labels: ['agent::ready'] },
      13: { number: 13, title: 'D', state: 'OPEN', labels: ['agent::blocked'] },
    });
    const logger = silentLogger();
    const reporter = new ProgressReporter({
      provider,
      epicId: 42,
      intervalSec: 60,
      logger,
    });
    reporter.setWave({
      index: 0,
      totalWaves: 1,
      stories: [10, 11, 12, 13],
      startedAt: new Date(Date.now() - 90_000).toISOString(),
    });
    const { rows, body } = await reporter.fire();
    assert.equal(rows[0].state, 'done');
    assert.equal(rows[1].state, 'in-flight');
    assert.equal(rows[2].state, 'queued');
    assert.equal(rows[3].state, 'blocked');
    assert.match(body, /Wave 1\/1 · 1\/4 closed/);
    assert.match(body, /#10 \| ✅ done \| A/);
    assert.match(body, /#13 \| 🚧 blocked \| D/);
    assert.match(body, /1 stor[y] blocked: #13/);
    assert.equal(logger.log.info.length, 1);
  });

  it('upserts a structured comment with the progress type', async () => {
    const provider = buildProvider({
      1: { number: 1, title: 'only', state: 'CLOSED', labels: [] },
    });
    const reporter = new ProgressReporter({
      provider,
      epicId: 9,
      intervalSec: 60,
      logger: silentLogger(),
    });
    reporter.setWave({ index: 0, totalWaves: 1, stories: [1] });
    await reporter.fire();
    const [comment] = await provider.listComments();
    assert.ok(
      comment.body.includes(
        `<!-- ap:structured-comment type="${EPIC_RUN_PROGRESS_TYPE}" -->`,
      ),
      'comment should include the structured-comment marker',
    );
  });

  it('drops re-entrant fires while one is in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = {
      async getTicket() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return { number: 1, title: '', state: 'OPEN', labels: [] };
      },
      async getTicketComments() {
        return [];
      },
      async postComment() {
        return { id: '1' };
      },
    };
    const reporter = new ProgressReporter({
      provider,
      epicId: 1,
      intervalSec: 60,
      logger: silentLogger(),
    });
    reporter.setWave({ index: 0, totalWaves: 1, stories: [1] });
    await Promise.all([reporter.fire(), reporter.fire(), reporter.fire()]);
    assert.equal(peak, 1, 'only one fire should execute at a time');
  });

  it('renders all waves when setPlan is called, with a Wave column', async () => {
    const provider = buildProvider({
      10: { number: 10, title: 'A', state: 'CLOSED', labels: [] },
      11: { number: 11, title: 'B', state: 'CLOSED', labels: [] },
      20: {
        number: 20,
        title: 'C',
        state: 'OPEN',
        labels: ['agent::executing'],
      },
    });
    const logger = silentLogger();
    const reporter = new ProgressReporter({
      provider,
      epicId: 7,
      intervalSec: 60,
      logger,
    });
    reporter.setPlan({
      waves: [
        [
          { id: 10, title: 'A' },
          { id: 11, title: 'B' },
        ],
        [{ id: 20, title: 'C' }],
      ],
      startedAt: new Date(Date.now() - 600_000).toISOString(),
    });
    reporter.setWave({
      index: 1,
      totalWaves: 2,
      stories: [20],
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const { rows, body } = await reporter.fire();
    assert.equal(rows.length, 3, 'rows cover every wave, not just the active');
    assert.match(body, /Wave 2\/2 · 2\/3 closed/);
    assert.match(body, /\| Wave \| ID \| State \| Title \|/);
    assert.match(body, /\| 1 \| #10 \| ✅ done \| A \|/);
    assert.match(body, /\| 1 \| #11 \| ✅ done \| B \|/);
    assert.match(body, /\| 2 \| #20 \| 🔧 in-flight \| C \|/);
  });

  it('renders fixture story states (not unknown) when the GraphQL read succeeds', async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../fixtures/progress-reporter-stories.json', import.meta.url),
        'utf8',
      ),
    );
    const tickets = Object.fromEntries(
      fixture.stories.map((s) => [s.number, s]),
    );
    const provider = buildProvider(tickets);
    const reporter = new ProgressReporter({
      provider,
      epicId: 77,
      intervalSec: 60,
      logger: silentLogger(),
    });
    reporter.setWave({
      index: 0,
      totalWaves: 1,
      stories: fixture.stories.map((s) => s.number),
    });

    const { rows } = await reporter.fire();
    const unknown = rows.filter((r) => r.state === 'unknown');
    assert.equal(unknown.length, 0, 'no fixture story should fall back to unknown');
    assert.deepEqual(
      rows.map((r) => [r.id, r.state]),
      [
        [501, 'done'],
        [502, 'in-flight'],
        [503, 'queued'],
        [504, 'blocked'],
      ],
    );
  });

  it('propagates provider errors from fire() (fail loud)', async () => {
    const provider = {
      async getTicket() {
        throw new Error('variableNotUsed: $issueId');
      },
      async getTicketComments() {
        return [];
      },
      async postComment() {
        return { id: '1' };
      },
    };
    const reporter = new ProgressReporter({
      provider,
      epicId: 1,
      intervalSec: 60,
      logger: silentLogger(),
    });
    reporter.setWave({ index: 0, totalWaves: 1, stories: [1] });
    await assert.rejects(() => reporter.fire(), /variableNotUsed/);
  });

  it('stop() emits a final snapshot and clears the interval', async () => {
    let intervalCleared = false;
    const fakeSetInterval = () => ({ ref: () => {}, unref: () => {} });
    const fakeClearInterval = () => {
      intervalCleared = true;
    };
    const provider = buildProvider({
      1: { number: 1, title: 'x', state: 'CLOSED', labels: [] },
    });
    const reporter = new ProgressReporter({
      provider,
      epicId: 1,
      intervalSec: 60,
      logger: silentLogger(),
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    reporter.setWave({ index: 0, totalWaves: 1, stories: [1] });
    reporter.start();
    await reporter.stop();
    assert.equal(intervalCleared, true);
    const [comment] = await provider.listComments();
    assert.ok(comment.body.includes('Progress — Wave 1/1'));
  });
});
