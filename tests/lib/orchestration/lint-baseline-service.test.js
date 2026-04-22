import assert from 'node:assert/strict';
import test from 'node:test';
import { LintBaselineService } from '../../../.agents/scripts/lib/orchestration/lint-baseline-service.js';

function createLogger() {
  const calls = { info: [], warn: [] };
  return {
    calls,
    info: (channel, msg) => calls.info.push({ channel, msg }),
    warn: (channel, msg) => calls.warn.push({ channel, msg }),
  };
}

function stubFs(existsMap = {}) {
  return {
    existsSync: (p) => Boolean(existsMap[p]),
  };
}

test('LintBaselineService.capture: skips when baseline already exists', async () => {
  let execCalled = false;
  const vlog = createLogger();
  const service = new LintBaselineService({
    exec: () => {
      execCalled = true;
    },
    vlog,
    settings: { scriptsRoot: '.agents/scripts' },
    fs: { existsSync: () => true },
  });

  const result = await service.capture('epic/42');

  assert.equal(result.skipped, true);
  assert.equal(execCalled, false);
  assert.equal(vlog.calls.info.length, 1);
  assert.match(vlog.calls.info[0].msg, /already exists/);
});

test('LintBaselineService.capture: invokes exec with node + lint-baseline capture args when absent', async () => {
  const execCalls = [];
  const vlog = createLogger();
  const service = new LintBaselineService({
    exec: (file, args, options) => {
      execCalls.push({ file, args, options });
    },
    vlog,
    settings: { scriptsRoot: '.agents/scripts' },
    fs: stubFs(),
  });

  const result = await service.capture('epic/42');

  assert.deepEqual(result, { skipped: false, captured: true });
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].file, 'node');
  assert.equal(execCalls[0].args.length, 2);
  assert.match(execCalls[0].args[0], /lint-baseline\.js$/);
  assert.equal(execCalls[0].args[1], 'capture');
  assert.equal(execCalls[0].options.shell, false);
  assert.match(vlog.calls.info[0].msg, /Capturing lint baseline on epic\/42/);
});

test('LintBaselineService.capture: supports async exec adapters', async () => {
  let resolved = false;
  const vlog = createLogger();
  const service = new LintBaselineService({
    exec: async () => {
      await new Promise((r) => setImmediate(r));
      resolved = true;
    },
    vlog,
    settings: { scriptsRoot: '.agents/scripts' },
    fs: stubFs(),
  });

  const result = await service.capture('epic/7');

  assert.equal(resolved, true);
  assert.equal(result.captured, true);
});

test('LintBaselineService.capture: swallows exec failures and logs at warn', async () => {
  const vlog = createLogger();
  const service = new LintBaselineService({
    exec: () => {
      throw new Error('spawn ENOENT');
    },
    vlog,
    settings: { scriptsRoot: '.agents/scripts' },
    fs: stubFs(),
  });

  const result = await service.capture('epic/9');

  assert.equal(result.skipped, false);
  assert.equal(result.captured, false);
  assert.match(result.error, /spawn ENOENT/);
  assert.equal(vlog.calls.warn.length, 1);
  assert.match(vlog.calls.warn[0].msg, /non-fatal/);
});

test('LintBaselineService.capture: honours custom lintBaselinePath in settings', async () => {
  const seen = [];
  const vlog = createLogger();
  const service = new LintBaselineService({
    exec: () => {},
    vlog,
    settings: {
      scriptsRoot: '.agents/scripts',
      lintBaselinePath: 'custom/where/baseline.json',
    },
    fs: {
      existsSync: (p) => {
        seen.push(p);
        return true;
      },
    },
  });

  await service.capture('epic/1');

  assert.equal(seen.length, 1);
  assert.match(seen[0], /custom[\\/]where[\\/]baseline\.json$/);
});
