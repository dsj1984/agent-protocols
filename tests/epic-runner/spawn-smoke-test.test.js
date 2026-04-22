import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SpawnSmokeTest } from '../../.agents/scripts/lib/orchestration/epic-runner/spawn-smoke-test.js';

function fakeSpawnFactory({ exitCode = 0, exitDelayMs = 0, emitError } = {}) {
  return function fakeSpawn() {
    const proc = new EventEmitter();
    proc.kill = () => {};
    if (emitError) {
      setImmediate(() => proc.emit('error', emitError));
    } else if (Number.isFinite(exitDelayMs)) {
      setTimeout(() => proc.emit('exit', exitCode), exitDelayMs);
    }
    return proc;
  };
}

describe('SpawnSmokeTest', () => {
  it('resolves ok when the spawned process exits 0', async () => {
    const smoke = new SpawnSmokeTest({
      spawn: fakeSpawnFactory({ exitCode: 0 }),
    });
    const result = await smoke.verify();
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.detail, /exited 0/);
  });

  it('resolves !ok when the spawned process exits non-zero', async () => {
    const smoke = new SpawnSmokeTest({
      spawn: fakeSpawnFactory({ exitCode: 127 }),
    });
    const result = await smoke.verify();
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 127);
    assert.match(result.detail, /127/);
  });

  it('resolves !ok with null exitCode when the spawn times out', async () => {
    const smoke = new SpawnSmokeTest({
      spawn: fakeSpawnFactory({ exitDelayMs: Number.POSITIVE_INFINITY }),
      timeoutMs: 25,
    });
    const result = await smoke.verify();
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.match(result.detail, /within 25ms/);
  });

  it('resolves !ok when the spawn emits an error event', async () => {
    const smoke = new SpawnSmokeTest({
      spawn: fakeSpawnFactory({ emitError: new Error('ENOENT claude') }),
    });
    const result = await smoke.verify();
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.match(result.detail, /ENOENT claude/);
  });

  it('defaults to node:child_process.spawn when none is injected', () => {
    const smoke = new SpawnSmokeTest({});
    assert.equal(typeof smoke.spawn, 'function');
  });

  it('refuses construction when spawn is explicitly not a function', () => {
    assert.throws(
      () => new SpawnSmokeTest({ spawn: 'not-a-function' }),
      /requires a spawn adapter/,
    );
  });
});
