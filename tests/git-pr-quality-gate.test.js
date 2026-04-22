import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CHECKS,
  runQualityGate,
} from '../.agents/scripts/git-pr-quality-gate.js';

const passingRunner = (c) => ({
  name: c.name,
  cmd: c.cmd.join(' '),
  status: 0,
  stdout: 'ok',
  stderr: '',
  durationMs: 1,
});

describe('git-pr-quality-gate.runQualityGate', () => {
  it('returns ok: true when every check passes', () => {
    const result = runQualityGate({
      checks: DEFAULT_CHECKS,
      runner: passingRunner,
    });
    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 3);
    assert.equal(result.failed.length, 0);
  });

  it('reports each failing check with a trimmed reason', () => {
    const failRunner = (c) => ({
      name: c.name,
      cmd: c.cmd.join(' '),
      status: c.name === 'test' ? 1 : 0,
      stdout: '',
      stderr: c.name === 'test' ? 'AssertionError: boom' : '',
      durationMs: 2,
    });
    const result = runQualityGate({
      checks: DEFAULT_CHECKS,
      runner: failRunner,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].name, 'test');
    assert.match(result.failed[0].reason, /exit 1/);
    assert.match(result.failed[0].reason, /AssertionError/);
  });

  it('honours the skip set without marking it as a failure', () => {
    const result = runQualityGate({
      checks: DEFAULT_CHECKS,
      skip: ['test'],
      runner: passingRunner,
    });
    assert.equal(result.ok, true);
    const testEntry = result.checks.find((c) => c.name === 'test');
    assert.equal(testEntry.skipped, true);
    assert.equal(testEntry.status, 0);
  });
});
