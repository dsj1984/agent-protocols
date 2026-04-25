import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBudget,
  PLANNING_CONTEXT_DEFAULTS,
  summarizeDoc,
} from '../../.agents/scripts/lib/orchestration/planning-context-budget.js';

const SAMPLE_DOC = `Preamble paragraph that introduces the doc.

It has a second paragraph the summariser should drop.

## First Heading

Body of the first section.

Second paragraph of the first section, also dropped.

### Sub-section

Indented detail.

## Second Heading

Body of the second section.
`;

describe('summarizeDoc', () => {
  it('extracts ## and ### headings preserving order', () => {
    const out = summarizeDoc('docs/sample.md', SAMPLE_DOC);
    assert.deepEqual(out.headings, [
      'First Heading',
      'Sub-section',
      'Second Heading',
    ]);
  });

  it('emits per-section excerpts including a preamble entry', () => {
    const out = summarizeDoc('docs/sample.md', SAMPLE_DOC);
    assert.equal(out.path, 'docs/sample.md');
    assert.ok(out.excerpts.length >= 2, 'expected at least preamble + 1');
    assert.equal(out.excerpts[0].heading, null);
    assert.match(out.excerpts[0].snippet, /Preamble paragraph/);
    const first = out.excerpts.find((e) => e.heading === 'First Heading');
    assert.ok(first, 'first heading excerpt missing');
    assert.match(first.snippet, /Body of the first section/);
  });

  it('reports byteSize of the original content', () => {
    const out = summarizeDoc('docs/sample.md', SAMPLE_DOC);
    assert.equal(out.byteSize, Buffer.byteLength(SAMPLE_DOC, 'utf-8'));
  });

  it('keeps total excerpts inside the maxBytes budget', () => {
    const huge = `${SAMPLE_DOC}\n${'lorem ipsum '.repeat(1000)}`;
    const out = summarizeDoc('docs/huge.md', huge, 600);
    const total = out.excerpts.reduce(
      (s, e) => s + Buffer.byteLength(e.snippet, 'utf-8'),
      0,
    );
    assert.ok(total <= 600, `excerpts ${total}B exceeded 600B budget`);
  });

  it('handles non-string content as empty', () => {
    const out = summarizeDoc('docs/none.md', null);
    assert.equal(out.byteSize, 0);
    assert.deepEqual(out.headings, []);
    assert.deepEqual(out.excerpts, []);
  });
});

describe('applyBudget — summaryMode', () => {
  const docs = [
    { path: 'docs/a.md', content: SAMPLE_DOC },
    { path: 'docs/b.md', content: SAMPLE_DOC },
  ];

  it("summaryMode='never' returns full mode with original content", () => {
    const out = applyBudget(docs, { maxBytes: 50, summaryMode: 'never' });
    assert.equal(out.mode, 'full');
    assert.equal(out.items[0].content, SAMPLE_DOC);
    assert.ok(out.items[0].byteSize > 0);
  });

  it("summaryMode='always' returns summary mode regardless of size", () => {
    const small = [{ path: 'docs/tiny.md', content: '## H\n\ntext\n' }];
    const out = applyBudget(small, { maxBytes: 1000000, summaryMode: 'always' });
    assert.equal(out.mode, 'summary');
    assert.deepEqual(out.items[0].headings, ['H']);
    assert.equal(out.items[0].excerpts.length >= 1, true);
  });

  it("summaryMode='auto' returns full when payload fits", () => {
    const small = [{ path: 'docs/tiny.md', content: 'small body' }];
    const out = applyBudget(small, { maxBytes: 50000, summaryMode: 'auto' });
    assert.equal(out.mode, 'full');
    assert.equal(out.items[0].content, 'small body');
  });

  it("summaryMode='auto' returns summary when payload overflows", () => {
    const out = applyBudget(docs, { maxBytes: 100, summaryMode: 'auto' });
    assert.equal(out.mode, 'summary');
    assert.equal(out.items.length, 2);
    for (const it of out.items) {
      assert.ok(Array.isArray(it.headings));
      assert.ok(Array.isArray(it.excerpts));
      assert.ok(typeof it.byteSize === 'number');
      assert.equal(typeof it.path, 'string');
    }
  });

  it('opts.fullContext=true forces full regardless of summaryMode', () => {
    const out = applyBudget(docs, { maxBytes: 100, summaryMode: 'always' }, {
      fullContext: true,
    });
    assert.equal(out.mode, 'full');
    assert.equal(out.items[0].content, SAMPLE_DOC);
  });

  it('falls back to defaults when limits is omitted', () => {
    const out = applyBudget(docs);
    assert.ok(out.mode === 'full' || out.mode === 'summary');
    assert.equal(typeof out.totalBytes, 'number');
  });

  it('reports totalBytes equal to sum of input content sizes', () => {
    const out = applyBudget(docs, { maxBytes: 1000000 });
    const expected = docs.reduce(
      (s, d) => s + Buffer.byteLength(d.content, 'utf-8'),
      0,
    );
    assert.equal(out.totalBytes, expected);
  });

  it('treats {name, content} input as equivalent to {path, content}', () => {
    const out = applyBudget([{ name: 'docs/x.md', content: SAMPLE_DOC }], {
      summaryMode: 'always',
    });
    assert.equal(out.items[0].path, 'docs/x.md');
  });

  it('exposes module defaults that match the schema', () => {
    assert.equal(PLANNING_CONTEXT_DEFAULTS.maxBytes, 50000);
    assert.equal(PLANNING_CONTEXT_DEFAULTS.summaryMode, 'auto');
  });
});
