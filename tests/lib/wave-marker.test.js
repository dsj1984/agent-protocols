import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWaveMarker,
  WAVE_MARKER_RE,
} from '../../.agents/scripts/lib/orchestration/wave-marker.js';

test('WAVE_MARKER_RE — bounded wave-N-{start,end}', async (t) => {
  await t.test('accepts 1-3 digit wave indices', () => {
    for (const marker of [
      'wave-0-start',
      'wave-0-end',
      'wave-9-start',
      'wave-9-end',
      'wave-12-start',
      'wave-99-end',
      'wave-100-start',
      'wave-999-end',
    ]) {
      assert.ok(
        WAVE_MARKER_RE.test(marker),
        `${marker} should match WAVE_MARKER_RE`,
      );
    }
  });

  await t.test('rejects indices of 4+ digits (>=1000)', () => {
    for (const marker of [
      'wave-1000-start',
      'wave-1000-end',
      'wave-12345-start',
    ]) {
      assert.ok(
        !WAVE_MARKER_RE.test(marker),
        `${marker} should NOT match WAVE_MARKER_RE`,
      );
    }
  });

  await t.test('rejects non-digit, empty, and malformed indices', () => {
    for (const marker of [
      'wave-abc-start',
      'wave--start',
      'wave--end',
      'wave-1-middle',
      'wave-1',
      'wave-1-',
      'wave-01a-start',
      'WAVE-1-start',
      'wave-1-START',
      ' wave-1-start',
      'wave-1-start ',
      '',
    ]) {
      assert.ok(
        !WAVE_MARKER_RE.test(marker),
        `${marker} should NOT match WAVE_MARKER_RE`,
      );
    }
  });
});

test('parseWaveMarker — returns {index, phase} or null', async (t) => {
  await t.test('returns parsed object for accepted markers', () => {
    const cases = [
      ['wave-0-start', { index: 0, phase: 'start' }],
      ['wave-9-start', { index: 9, phase: 'start' }],
      ['wave-99-end', { index: 99, phase: 'end' }],
      ['wave-999-end', { index: 999, phase: 'end' }],
      ['wave-12-start', { index: 12, phase: 'start' }],
    ];
    for (const [input, expected] of cases) {
      assert.deepEqual(
        parseWaveMarker(input),
        expected,
        `parseWaveMarker(${JSON.stringify(input)})`,
      );
    }
  });

  await t.test('returns null for rejected markers', () => {
    for (const input of [
      'wave-1000-start',
      'wave-abc-start',
      'wave--start',
      'wave-1-middle',
      'wave-1',
      'wave-1-',
      '',
    ]) {
      assert.equal(
        parseWaveMarker(input),
        null,
        `parseWaveMarker(${JSON.stringify(input)}) should be null`,
      );
    }
  });

  await t.test('returns null for non-string inputs', () => {
    for (const input of [null, undefined, 0, 1, {}, [], true, false]) {
      assert.equal(
        parseWaveMarker(input),
        null,
        `parseWaveMarker(${String(input)}) should be null`,
      );
    }
  });

  await t.test('phase is always "start" or "end" — never other suffix', () => {
    // Guard against a future regression where the capture group is widened.
    for (const input of ['wave-1-middle', 'wave-1-started', 'wave-1-ended']) {
      assert.equal(parseWaveMarker(input), null);
    }
  });
});
