import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { Logger, NOOP_LOGGER } from '../../.agents/scripts/lib/Logger.js';

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

  it('debug does not log at default info level', () => {
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

describe('NOOP_LOGGER', () => {
  it('exposes the documented method surface (debug/info/warn/error) but no fatal', () => {
    assert.equal(typeof NOOP_LOGGER.debug, 'function');
    assert.equal(typeof NOOP_LOGGER.info, 'function');
    assert.equal(typeof NOOP_LOGGER.warn, 'function');
    assert.equal(typeof NOOP_LOGGER.error, 'function');
    // fatal is intentionally absent — silencing process-exit is a footgun.
    assert.equal('fatal' in NOOP_LOGGER, false);
  });

  it('every method is a no-op that returns undefined and never throws', () => {
    assert.equal(NOOP_LOGGER.debug('any payload'), undefined);
    assert.equal(NOOP_LOGGER.info('any payload'), undefined);
    assert.equal(NOOP_LOGGER.warn('any payload'), undefined);
    assert.equal(NOOP_LOGGER.error('any payload'), undefined);
  });

  it('is frozen so consumers cannot mutate the shared instance', () => {
    assert.equal(Object.isFrozen(NOOP_LOGGER), true);
    assert.throws(() => {
      NOOP_LOGGER.warn = () => {
        throw new Error('mutated');
      };
    });
  });

  it('carries a `silent` discriminator for callers that branch on it', () => {
    assert.equal(NOOP_LOGGER.silent, true);
  });
});
