import assert from 'node:assert';
import { test } from 'node:test';
import {
  formatRecutMarker,
  injectRecutMarker,
  parseRecutMarker,
} from '../../.agents/scripts/lib/orchestration/recut.js';

test('parseRecutMarker - finds standard marker', () => {
  const body = 'Some body\n\n<!-- recut-of: #641 -->\n';
  assert.deepStrictEqual(parseRecutMarker(body), {
    parentStoryId: 641,
    raw: '<!-- recut-of: #641 -->',
  });
});

test('parseRecutMarker - tolerates missing #, extra whitespace', () => {
  const body = 'x\n<!--   recut-of:   641   -->\n';
  assert.strictEqual(parseRecutMarker(body)?.parentStoryId, 641);
});

test('parseRecutMarker - returns null when absent', () => {
  assert.strictEqual(parseRecutMarker('no marker here'), null);
  assert.strictEqual(parseRecutMarker(null), null);
  assert.strictEqual(parseRecutMarker(undefined), null);
});

test('formatRecutMarker - returns canonical form', () => {
  assert.strictEqual(formatRecutMarker(42), '<!-- recut-of: #42 -->');
});

test('injectRecutMarker - appends marker when absent', () => {
  const body = '## Story\n\nSome description.';
  const out = injectRecutMarker(body, 641);
  assert.match(out, /<!-- recut-of: #641 -->/);
  assert.ok(out.startsWith('## Story'));
});

test('injectRecutMarker - replaces existing marker with different parent', () => {
  const body = '## Story\n\n<!-- recut-of: #1 -->\n';
  const out = injectRecutMarker(body, 2);
  assert.match(out, /<!-- recut-of: #2 -->/);
  assert.doesNotMatch(out, /<!-- recut-of: #1 -->/);
});

test('injectRecutMarker - no-op when marker already matches', () => {
  const body = '## Story\n\n<!-- recut-of: #5 -->\n';
  assert.strictEqual(injectRecutMarker(body, 5), body);
});

test('injectRecutMarker - handles empty/null body', () => {
  assert.strictEqual(injectRecutMarker('', 7), '<!-- recut-of: #7 -->\n');
  assert.strictEqual(
    injectRecutMarker(undefined, 7),
    '<!-- recut-of: #7 -->\n',
  );
});
