/**
 * parse-id-list.test.js — the shared Story-id list expander.
 *
 * Tier: unit. Pure parsing, no I/O.
 *
 * Covers the dash-range shape an operator types at `/mandrel-deliver` — a contiguous
 * span written `4922-4926` rather than enumerated — plus the guards that keep
 * a typo (`1-4926`) or a backwards span from being read as a delivery set.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { expandIdList } from '../../.agents/scripts/lib/util/parse-id-list.js';

/**
 * The default span cap, asserted as the literal the docs publish rather than
 * imported from the module — `helpers/deliver-reference.md` § Ranges states
 * it, so a test reading the constant back could not catch the two drifting.
 */
const MAX_RANGE_SPAN = 50;

describe('expandIdList — plain lists', () => {
  it('returns an empty list for absent / empty input', () => {
    assert.deepEqual(expandIdList(undefined), { ids: [], error: null });
    assert.deepEqual(expandIdList(''), { ids: [], error: null });
  });

  it('parses a comma-separated list, deduped in first-seen order', () => {
    const { ids, error } = expandIdList('101, 103,101');
    assert.equal(error, null);
    assert.deepEqual(ids, [101, 103]);
  });

  it('skips empty tokens from a trailing comma or stray whitespace', () => {
    const { ids, error } = expandIdList('5, ,6,');
    assert.equal(error, null);
    assert.deepEqual(ids, [5, 6]);
  });

  it('accepts an optional # prefix, matching what an operator types', () => {
    const { ids, error } = expandIdList('#101,#103');
    assert.equal(error, null);
    assert.deepEqual(ids, [101, 103]);
  });

  it('rejects a non-numeric token', () => {
    const { ids, error } = expandIdList('5,abc');
    assert.equal(ids, null);
    assert.match(error, /positive issue numbers or A-B ranges/);
    assert.match(error, /"abc"/);
  });

  it('rejects a non-positive token', () => {
    const { ids, error } = expandIdList('5,0');
    assert.equal(ids, null);
    assert.match(error, /"0"/);
  });
});

describe('expandIdList — dash ranges', () => {
  it('expands an inclusive A-B range', () => {
    const { ids, error } = expandIdList('4922-4926');
    assert.equal(error, null);
    assert.deepEqual(ids, [4922, 4923, 4924, 4925, 4926]);
  });

  it('tolerates whitespace around the dash, as typed', () => {
    const { ids, error } = expandIdList('4922 - 4924');
    assert.equal(error, null);
    assert.deepEqual(ids, [4922, 4923, 4924]);
  });

  it('accepts en dash and em dash separators', () => {
    assert.deepEqual(expandIdList('101–103').ids, [101, 102, 103]);
    assert.deepEqual(expandIdList('101—103').ids, [101, 102, 103]);
  });

  it('accepts a # prefix on either endpoint', () => {
    const { ids, error } = expandIdList('#101-#103');
    assert.equal(error, null);
    assert.deepEqual(ids, [101, 102, 103]);
  });

  it('treats a single-id range as that one id', () => {
    assert.deepEqual(expandIdList('4922-4922').ids, [4922]);
  });

  it('mixes ranges and singles in one list, deduping the overlap', () => {
    const { ids, error } = expandIdList('4920,4922-4924,4923');
    assert.equal(error, null);
    assert.deepEqual(ids, [4920, 4922, 4923, 4924]);
  });

  it('rejects a backwards range rather than silently emptying it', () => {
    const { ids, error } = expandIdList('4926-4922');
    assert.equal(ids, null);
    assert.match(error, /low-to-high/);
    assert.match(error, /"4926-4922"/);
  });

  it('rejects a range wider than the span cap', () => {
    const { ids, error } = expandIdList(`1-${MAX_RANGE_SPAN + 1}`);
    assert.equal(ids, null);
    assert.match(error, new RegExp(String(MAX_RANGE_SPAN)));
  });

  it('accepts a range exactly at the span cap', () => {
    const { ids, error } = expandIdList(`1-${MAX_RANGE_SPAN}`);
    assert.equal(error, null);
    assert.equal(ids.length, MAX_RANGE_SPAN);
  });

  it('rejects a malformed range (missing endpoint, triple dash)', () => {
    assert.equal(expandIdList('4922-').ids, null);
    assert.equal(expandIdList('-4926').ids, null);
    assert.equal(expandIdList('4922-4923-4924').ids, null);
  });

  it('rejects a non-positive range endpoint', () => {
    const { ids, error } = expandIdList('0-3');
    assert.equal(ids, null);
    assert.ok(error);
  });
});

describe('expandIdList — message shaping', () => {
  it('names the flag and prefix the caller supplies', () => {
    const { error } = expandIdList('abc', {
      flag: '--done',
      prefix: '[wave-tick] ',
    });
    assert.match(error, /^\[wave-tick\] --done /);
  });

  it('honours a caller-supplied span cap', () => {
    const { ids, error } = expandIdList('1-5', { maxSpan: 4 });
    assert.equal(ids, null);
    assert.match(error, /5 ids/);
  });
});
