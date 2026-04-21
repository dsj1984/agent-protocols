import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BookendChainer } from '../../.agents/scripts/lib/orchestration/epic-runner/bookend-chainer.js';

function quietLogger() {
  return { info: () => {}, warn: () => {} };
}

function recordingProvider() {
  const comments = [];
  return {
    comments,
    postComment: async (id, payload) => {
      comments.push({ id, payload });
    },
  };
}

describe('BookendChainer', () => {
  it('posts hand-off comment and exits when autoClose=false', async () => {
    const provider = recordingProvider();
    const chainer = new BookendChainer({
      autoClose: false,
      epicId: 321,
      postComment: provider.postComment,
      runSkill: async () => {
        throw new Error('must not be called');
      },
      logger: quietLogger(),
    });

    const result = await chainer.run();
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'autoClose-disabled');
    assert.equal(provider.comments.length, 1);
    assert.match(provider.comments[0].payload.body, /agent::review/);
    assert.match(provider.comments[0].payload.body, /sprint-code-review/);
  });

  it('runs all three skills in order when autoClose=true and each succeeds', async () => {
    const provider = recordingProvider();
    const calls = [];
    const chainer = new BookendChainer({
      autoClose: true,
      epicId: 321,
      postComment: provider.postComment,
      runSkill: async (skill, args) => {
        calls.push({ skill, args });
        return { status: 'ok' };
      },
      logger: quietLogger(),
    });

    const result = await chainer.run();
    assert.equal(result.executed, true);
    assert.equal(result.completed, true);
    assert.deepEqual(
      calls.map((c) => c.skill),
      ['/sprint-code-review', '/sprint-retro', '/sprint-close'],
    );
    for (const c of calls) assert.equal(c.args.epicId, 321);
  });

  it('halts the chain and posts a friction comment on the first failure', async () => {
    const provider = recordingProvider();
    const chainer = new BookendChainer({
      autoClose: true,
      epicId: 321,
      postComment: provider.postComment,
      runSkill: async (skill) => {
        if (skill === '/sprint-retro')
          return { status: 'failed', detail: 'retro explode' };
        return { status: 'ok' };
      },
      logger: quietLogger(),
    });

    const result = await chainer.run();
    assert.equal(result.executed, true);
    assert.equal(result.completed, false);
    assert.equal(result.results.length, 2, 'chain stops at the failing step');

    const friction = provider.comments.find(
      (c) => c.payload.type === 'friction',
    );
    assert.ok(friction, 'friction comment emitted on failure');
    assert.match(friction.payload.body, /halted at `\/sprint-retro`/);
    assert.match(friction.payload.body, /retro explode/);
    assert.match(friction.payload.body, /sprint-code-review/);
  });

  it('autoClose=true but no runSkill adapter → skipped with hand-off comment', async () => {
    const provider = recordingProvider();
    const chainer = new BookendChainer({
      autoClose: true,
      epicId: 321,
      postComment: provider.postComment,
      logger: quietLogger(),
    });

    const result = await chainer.run();
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'no-runSkill');
    assert.equal(provider.comments.length, 1);
    assert.match(provider.comments[0].payload.body, /missing-runSkill/);
  });

  it('rejects non-integer epicId at construction', () => {
    assert.throws(() => new BookendChainer({ autoClose: false }), TypeError);
  });
});
