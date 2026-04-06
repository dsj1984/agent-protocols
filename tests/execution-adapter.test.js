/**
 * Execution Adapter Interface & Factory Tests
 *
 * Tests:
 *  - IExecutionAdapter contract enforcement
 *  - ManualDispatchAdapter behaviour
 *  - adapter-factory resolution
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, '.agents', 'scripts', 'lib');
const ADAPTERS = path.join(ROOT, '.agents', 'scripts', 'adapters');
const SCRIPTS = path.join(ROOT, '.agents', 'scripts');

const { IExecutionAdapter } = await import(
  pathToFileURL(path.join(LIB, 'IExecutionAdapter.js')).href
);
const { ManualDispatchAdapter } = await import(
  pathToFileURL(path.join(ADAPTERS, 'manual.js')).href
);
const { createAdapter, listAdapters } = await import(
  pathToFileURL(path.join(LIB, 'adapter-factory.js')).href
);

// ---------------------------------------------------------------------------
// IExecutionAdapter — contract enforcement
// ---------------------------------------------------------------------------

describe('IExecutionAdapter — abstract contract', () => {
  const adapter = new IExecutionAdapter();

  it('throws Not implemented on executorId getter', () => {
    assert.throws(() => adapter.executorId, /Not implemented: executorId getter/);
  });

  it('throws Not implemented on dispatchTask()', async () => {
    await assert.rejects(() => adapter.dispatchTask({}), /Not implemented: dispatchTask/);
  });

  it('throws Not implemented on getTaskStatus()', async () => {
    await assert.rejects(() => adapter.getTaskStatus('id'), /Not implemented: getTaskStatus/);
  });

  it('cancelTask() is a silent no-op by default', async () => {
    // M-5: cancelTask() should not throw — it's a no-op for adapters that don't support cancellation.
    await adapter.cancelTask('id'); // should not throw
  });

  it('describe() throws (executorId not implemented)', () => {
    assert.throws(() => adapter.describe(), /Not implemented: executorId getter/);
  });
});

// ---------------------------------------------------------------------------
// ManualDispatchAdapter
// ---------------------------------------------------------------------------

describe('ManualDispatchAdapter — HITL reference', () => {
  const orchestration = {
    provider: 'github',
    github: { owner: 'test-owner', repo: 'test-repo', operatorHandle: '@test' },
    executor: 'manual',
  };

  it('implements IExecutionAdapter', () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    assert.ok(adapter instanceof IExecutionAdapter);
  });

  it('executorId returns "manual"', () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    assert.equal(adapter.executorId, 'manual');
  });

  it('describe() returns a string containing "manual"', () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    assert.ok(adapter.describe().includes('manual'));
  });

  it('dispatchTask() returns { dispatchId, status: "dispatched" }', async () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    const result = await adapter.dispatchTask({
      taskId: 42,
      epicId: 1,
      branch: 'task/epic-1/42',
      epicBranch: 'epic/1',
      prompt: 'Implement feature X',
      persona: 'engineer',
      model: 'Gemini 3 Flash',
      mode: 'fast',
      skills: ['core/tdd'],
      focusAreas: ['src/'],
      metadata: { title: 'Task 42', protocolVersion: '5.0.0', dispatchedAt: new Date().toISOString() },
    });

    assert.equal(typeof result.dispatchId, 'string');
    assert.ok(result.dispatchId.length > 0);
    assert.equal(result.status, 'dispatched');
  });

  it('getTaskStatus() returns pending for dispatched task', async () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    const { dispatchId } = await adapter.dispatchTask({
      taskId: 99,
      epicId: 1,
      branch: 'task/epic-1/99',
      epicBranch: 'epic/1',
      prompt: 'test',
      persona: 'engineer',
      model: '',
      mode: 'fast',
      skills: [],
      focusAreas: [],
      metadata: {},
    });

    const status = await adapter.getTaskStatus(dispatchId);
    assert.equal(status.dispatchId, dispatchId);
    assert.equal(status.status, 'pending');
  });

  it('getTaskStatus() returns failed for unknown dispatchId', async () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    const result = await adapter.getTaskStatus('unknown-id');
    assert.equal(result.status, 'failed');
    assert.ok(result.message?.includes('unknown-id') || result.message?.includes('Unknown'));
  });

  it('cancelTask() marks dispatch as failed in registry', async () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    const { dispatchId } = await adapter.dispatchTask({
      taskId: 7,
      epicId: 1,
      branch: 'task/epic-1/7',
      epicBranch: 'epic/1',
      prompt: 'cancel me',
      persona: 'engineer',
      model: '',
      mode: 'fast',
      skills: [],
      focusAreas: [],
      metadata: {},
    });

    await adapter.cancelTask(dispatchId);
    const status = await adapter.getTaskStatus(dispatchId);
    assert.equal(status.status, 'failed');
  });

  it('getRegistry() returns a Map copy of dispatched tasks', async () => {
    const adapter = new ManualDispatchAdapter(orchestration);
    await adapter.dispatchTask({
      taskId: 5,
      epicId: 1,
      branch: 'task/epic-1/5',
      epicBranch: 'epic/1',
      prompt: 'Go',
      persona: 'engineer',
      model: '',
      mode: 'fast',
      skills: [],
      focusAreas: [],
      metadata: {},
    });

    const registry = adapter.getRegistry();
    assert.ok(registry instanceof Map);
    assert.equal(registry.size, 1);

    // Confirm it's a copy (mutating doesn't affect original)
    registry.clear();
    assert.equal(adapter.getRegistry().size, 1);
  });
});

// ---------------------------------------------------------------------------
// adapter-factory.js
// ---------------------------------------------------------------------------

describe('createAdapter — factory resolution', () => {
  const orchestration = {
    provider: 'github',
    github: { owner: 'o', repo: 'r', operatorHandle: '@op' },
  };

  it('returns ManualDispatchAdapter by default', () => {
    const adapter = createAdapter(orchestration);
    assert.ok(adapter instanceof IExecutionAdapter);
    assert.equal(adapter.executorId, 'manual');
  });

  it('returns ManualDispatchAdapter for executor: "manual"', () => {
    const adapter = createAdapter(orchestration, { executor: 'manual' });
    assert.equal(adapter.executorId, 'manual');
  });

  it('opts.executor overrides orchestration.executor', () => {
    const withOtherExec = { ...orchestration, executor: 'manual' };
    const adapter = createAdapter(withOtherExec, { executor: 'manual' });
    assert.equal(adapter.executorId, 'manual');
  });

  it('throws for unsupported executor', () => {
    assert.throws(
      () => createAdapter(orchestration, { executor: 'codex' }),
      /Unsupported executor "codex"/,
    );
  });

  it('includes supported executors in error message', () => {
    try {
      createAdapter(orchestration, { executor: 'jira-runner' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('manual'));
    }
  });

  it('null orchestration still resolves default executor', () => {
    // null orchestration is passed to adapter constructor, not checked by factory
    const adapter = createAdapter(null, { executor: 'manual' });
    assert.equal(adapter.executorId, 'manual');
  });
});

describe('listAdapters()', () => {
  it('returns an array of registered adapter names', () => {
    const names = listAdapters();
    assert.ok(Array.isArray(names));
    assert.ok(names.includes('manual'));
  });
});
