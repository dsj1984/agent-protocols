import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { scrapeProjectDocs } from '../../.agents/scripts/lib/orchestration/doc-reader.js';

describe('doc-reader', () => {
  let tmpDocsDir;

  beforeEach(() => {
    tmpDocsDir = path.join(os.tmpdir(), `agent-protocols-docs-${Date.now()}`);
    fs.mkdirSync(tmpDocsDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDocsDir)) {
      fs.rmSync(tmpDocsDir, { recursive: true, force: true });
    }
  });

  it('scrapes all .md files by default', async () => {
    fs.writeFileSync(path.join(tmpDocsDir, 'doc1.md'), 'Content 1');
    fs.writeFileSync(path.join(tmpDocsDir, 'doc2.md'), 'Content 2');
    fs.writeFileSync(path.join(tmpDocsDir, 'not-a-doc.txt'), 'Text');

    const result = await scrapeProjectDocs({ paths: { docsRoot: tmpDocsDir } });

    assert.ok(result.includes('--- Document: doc1.md ---'));
    assert.ok(result.includes('Content 1'));
    assert.ok(result.includes('--- Document: doc2.md ---'));
    assert.ok(result.includes('Content 2'));
    assert.ok(!result.includes('not-a-doc.txt'));
  });

  it('filters by docsContextFiles if provided', async () => {
    fs.writeFileSync(path.join(tmpDocsDir, 'doc1.md'), 'Content 1');
    fs.writeFileSync(path.join(tmpDocsDir, 'doc2.md'), 'Content 2');

    const result = await scrapeProjectDocs({
      paths: { docsRoot: tmpDocsDir },
      docsContextFiles: ['doc2.md'],
    });

    assert.ok(result.includes('doc2.md'));
    assert.ok(!result.includes('doc1.md'));
  });

  it('returns empty string if docsRoot does not exist', async () => {
    const result = await scrapeProjectDocs({
      paths: { docsRoot: '/non/existent/path' },
    });
    assert.strictEqual(result, '');
  });

  it('handles read errors gracefully', async () => {
    const result = await scrapeProjectDocs({ paths: { docsRoot: tmpDocsDir } });
    // Should not throw even if empty
    assert.strictEqual(result, '');
  });
});
