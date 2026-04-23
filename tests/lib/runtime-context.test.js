import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as defaultGit from '../../.agents/scripts/lib/git-utils.js';
import { createRuntimeContext } from '../../.agents/scripts/lib/runtime-context.js';

describe('createRuntimeContext', () => {
  it('returns a frozen bag with Node defaults when no overrides are passed', () => {
    const ctx = createRuntimeContext();
    assert.equal(ctx.git, defaultGit);
    assert.equal(typeof ctx.fs.readFileSync, 'function');
    assert.equal(typeof ctx.exec, 'function');
    assert.equal(typeof ctx.logger.info, 'function');
    assert.ok(Object.isFrozen(ctx));
  });

  it('threads injected overrides through unchanged', () => {
    const fakeGit = { gitSync: () => 'fake', gitSpawn: () => ({ status: 0 }) };
    const fakeFs = { existsSync: () => false, readFileSync: () => '' };
    const fakeExec = () => 'stubbed';
    const logs = [];
    const fakeLogger = { info: (m) => logs.push(m), warn() {}, error() {} };

    const ctx = createRuntimeContext({
      git: fakeGit,
      fs: fakeFs,
      exec: fakeExec,
      logger: fakeLogger,
    });

    assert.equal(ctx.git, fakeGit);
    assert.equal(ctx.fs, fakeFs);
    assert.equal(ctx.exec, fakeExec);
    assert.equal(ctx.logger, fakeLogger);
    ctx.logger.info('hello');
    assert.deepEqual(logs, ['hello']);
  });

  it('falls back per-channel — partial overrides do not clobber other defaults', () => {
    const fakeGit = { tag: 'injected' };
    const ctx = createRuntimeContext({ git: fakeGit });
    assert.equal(ctx.git, fakeGit);
    assert.equal(typeof ctx.fs.readFileSync, 'function');
    assert.equal(typeof ctx.exec, 'function');
  });
});
