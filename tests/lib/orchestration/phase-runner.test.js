/**
 * phase-runner — runPhase / runSafely tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  runPhase,
  runSafely,
} from '../../../.agents/scripts/lib/orchestration/phase-runner.js';

function captureLogger() {
  const errors = [];
  const warns = [];
  return {
    errors,
    warns,
    error: (m) => errors.push(m),
    warn: (m) => warns.push(m),
  };
}

describe('runPhase', () => {
  it('returns the function result on success', async () => {
    const logger = captureLogger();
    const result = await runPhase('init', () => 42, { logger });
    assert.equal(result, 42);
    assert.equal(logger.errors.length, 0);
  });

  it('awaits async functions', async () => {
    const result = await runPhase('init', async () => 'done');
    assert.equal(result, 'done');
  });

  it('logs [phase=<name>] prefix and returns fallback when fatal=false', async () => {
    const logger = captureLogger();
    const result = await runPhase(
      'cleanup',
      () => {
        throw new Error('boom');
      },
      { logger, fallback: 'safe-default' },
    );
    assert.equal(result, 'safe-default');
    assert.equal(logger.errors.length, 1);
    assert.equal(logger.errors[0], '[phase=cleanup] boom');
  });

  it('returns undefined when no fallback is provided', async () => {
    const logger = captureLogger();
    const result = await runPhase(
      'cleanup',
      () => {
        throw new Error('x');
      },
      { logger },
    );
    assert.equal(result, undefined);
  });

  it('rethrows the original error when fatal=true', async () => {
    const logger = captureLogger();
    const original = new Error('fatal-boom');
    await assert.rejects(
      runPhase(
        'init',
        () => {
          throw original;
        },
        { logger, fatal: true },
      ),
      (err) => err === original,
    );
    assert.equal(logger.errors[0], '[phase=init] fatal-boom');
  });

  it('handles non-Error throws by stringifying', async () => {
    const logger = captureLogger();
    await runPhase(
      'x',
      () => {
        throw 'literal';
      },
      { logger },
    );
    assert.equal(logger.errors[0], '[phase=x] literal');
  });

  it('works without a logger', async () => {
    const result = await runPhase('x', () => {
      throw new Error('y');
    });
    assert.equal(result, undefined);
  });
});

describe('runSafely', () => {
  it('returns the function result on success', async () => {
    const result = await runSafely(() => 'hi');
    assert.equal(result, 'hi');
  });

  it('swallows errors and logs via warn', async () => {
    const logger = captureLogger();
    const result = await runSafely(
      () => {
        throw new Error('best-effort failed');
      },
      { logger },
    );
    assert.equal(result, undefined);
    assert.equal(logger.warns.length, 1);
    assert.match(logger.warns[0], /\[phase=safe\] best-effort failed/);
    assert.equal(logger.errors.length, 0);
  });

  it('awaits async functions', async () => {
    const result = await runSafely(async () => 7);
    assert.equal(result, 7);
  });
});
