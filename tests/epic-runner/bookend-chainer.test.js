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

  it('invokes only /sprint-close when autoClose=true (review + retro remain operator-driven)', async () => {
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
      ['/sprint-close'],
      'auto-close must only fire /sprint-close',
    );
    assert.equal(calls[0].args.epicId, 321);
  });

  it('posts a friction comment when /sprint-close fails under autoClose', async () => {
    const provider = recordingProvider();
    const chainer = new BookendChainer({
      autoClose: true,
      epicId: 321,
      postComment: provider.postComment,
      runSkill: async () => ({ status: 'failed', detail: 'close explode' }),
      logger: quietLogger(),
    });

    const result = await chainer.run();
    assert.equal(result.executed, true);
    assert.equal(result.completed, false);
    assert.equal(result.results.length, 1, 'single-step auto-close');

    const friction = provider.comments.find(
      (c) => c.payload.type === 'friction',
    );
    assert.ok(friction, 'friction comment emitted on failure');
    assert.match(friction.payload.body, /halted at `\/sprint-close`/);
    assert.match(friction.payload.body, /close explode/);
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
