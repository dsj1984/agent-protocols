import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { Logger } from '../../.agents/scripts/lib/Logger.js';

describe('Logger', () => {
  beforeEach(() => {
    mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
    mock.method(process, 'exit', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('logs info', () => {
    Logger.info('test info');
    assert.strictEqual(console.log.mock.calls.length, 1);
    assert.strictEqual(
      console.log.mock.calls[0].arguments[0],
      '[Orchestrator] ℹ️ test info',
    );
  });

  it('logs warn', () => {
    Logger.warn('test warn');
    assert.strictEqual(console.warn.mock.calls.length, 1);
    assert.strictEqual(
      console.warn.mock.calls[0].arguments[0],
      '[Orchestrator] ⚠️ test warn',
    );
  });

  it('logs error', () => {
    Logger.error('test error');
    assert.strictEqual(console.error.mock.calls.length, 1);
    assert.strictEqual(
      console.error.mock.calls[0].arguments[0],
      '[Orchestrator] ❌ test error',
    );
  });

  it('logs fatal and exits', () => {
    Logger.fatal('test fatal');
    assert.strictEqual(console.error.mock.calls.length, 1);
    assert.strictEqual(
      console.error.mock.calls[0].arguments[0],
      '[Orchestrator] ❌ test fatal',
    );
    assert.strictEqual(process.exit.mock.calls.length, 1);
    assert.strictEqual(process.exit.mock.calls[0].arguments[0], 1);
  });

  it('debug does not log when AGENT_LOG_LEVEL is not debug', () => {
    Logger.debug('test debug');
    assert.strictEqual(console.error.mock.calls.length, 0);
  });

  it('createProgress defaults to stderr', () => {
    const progress = Logger.createProgress('MyScript');
    progress('phase', 'message');
    assert.strictEqual(console.error.mock.calls.length, 1);
    assert.strictEqual(
      console.error.mock.calls[0].arguments[0],
      '▶ [MyScript] [phase] message',
    );
    assert.strictEqual(console.log.mock.calls.length, 0);
  });

  it('createProgress uses stdout if stderr is false', () => {
    const progress = Logger.createProgress('MyScript', { stderr: false });
    progress('phase', 'message');
    assert.strictEqual(console.log.mock.calls.length, 1);
    assert.strictEqual(
      console.log.mock.calls[0].arguments[0],
      '▶ [MyScript] [phase] message',
    );
    assert.strictEqual(console.error.mock.calls.length, 0);
  });
});
