import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CHECKS,
  formatCheckLine,
  parseSkipList,
  renderHumanReport,
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

describe('formatCheckLine', () => {
  it('renders ✅ for status=0 and shows duration', () => {
    const line = formatCheckLine({ name: 'lint', status: 0, durationMs: 42 });
    assert.match(line, /✅ lint \(42ms\)/);
  });

  it('renders ❌ for non-zero status', () => {
    const line = formatCheckLine({ name: 'test', status: 1, durationMs: 7 });
    assert.match(line, /❌ test \(7ms\)/);
  });

  it('renders ⏭ and "(skipped)" suffix when check.skipped is true', () => {
    const line = formatCheckLine({
      name: 'mi',
      status: 0,
      durationMs: 0,
      skipped: true,
    });
    assert.match(line, /⏭ mi \(skipped\)/);
  });
});

describe('renderHumanReport', () => {
  it('on success: appends the all-passed footer to info, errors empty', () => {
    const out = renderHumanReport({
      ok: true,
      checks: [{ name: 'lint', status: 0, durationMs: 1 }],
      failed: [],
    });
    assert.equal(out.errors.length, 0);
    assert.ok(out.info.some((l) => l.includes('✅ lint')));
    assert.ok(out.info.some((l) => l.includes('All 1 check(s) passed')));
  });

  it('on failure: lists each failed check in errors with reason', () => {
    const out = renderHumanReport({
      ok: false,
      checks: [
        { name: 'lint', status: 0, durationMs: 1 },
        { name: 'test', status: 1, durationMs: 5 },
      ],
      failed: [{ name: 'test', reason: 'exit 1' }],
    });
    assert.ok(out.errors[0].includes('1 check(s) failed'));
    assert.ok(out.errors[1].includes('- test: exit 1'));
    assert.equal(
      out.info.some((l) => l.includes('All ')),
      false,
      'should not include the all-passed footer',
    );
  });
});

describe('parseSkipList', () => {
  it('returns [] for nullish, empty, or whitespace-only inputs', () => {
    assert.deepEqual(parseSkipList(undefined), []);
    assert.deepEqual(parseSkipList(null), []);
    assert.deepEqual(parseSkipList(''), []);
    assert.deepEqual(parseSkipList('   '), []);
  });

  it('splits on commas and trims', () => {
    assert.deepEqual(parseSkipList(' lint , mi '), ['lint', 'mi']);
  });

  it('drops empty tokens from extra/trailing commas', () => {
    assert.deepEqual(parseSkipList('lint,,test,'), ['lint', 'test']);
  });
});
