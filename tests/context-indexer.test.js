import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, '.agents', 'scripts', 'context-indexer.js');
const TEST_DIR = path.join(ROOT, 'temp', 'test-context-indexer');

describe('Context Indexer (Local RAG)', () => {
    before(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        fs.mkdirSync(TEST_DIR, { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'docs'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, '.agents', 'scripts'), { recursive: true });
        
        // Create some test docs
        fs.writeFileSync(path.join(TEST_DIR, 'docs', 'test1.md'), '# Test Document 1\n\nThis is a test content for indexing. It contains keywords like protocol and agent.');
        fs.writeFileSync(path.join(TEST_DIR, 'docs', 'test2.md'), '# Architecture\n\nDetailed system architecture overview. Focus on zero-dependency design patterns.');
        fs.writeFileSync(path.join(TEST_DIR, 'README.md'), '# Project README\n\nMain entry point for the repository. Explains how to use the local rag system.');
    });

    after(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('indexes documents and creates context-index.json', () => {
        const result = spawnSync('node', [SCRIPT_PATH, 'index'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0, `Script failed with: ${result.stderr}`);
        assert.ok(fs.existsSync(path.join(TEST_DIR, 'temp', 'context-index.json')), 'Index file was not created');
        
        const index = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'temp', 'context-index.json'), 'utf-8'));
        assert.ok(index.docs.length >= 3, 'Index should contain at least 3 documents');
        assert.ok(index.idf['protocol'] !== undefined, 'Index should contain "protocol" in IDF');
    });

    it('searches the index for relevant content', () => {
        // Ensure index exists first
        spawnSync('node', [SCRIPT_PATH, 'index'], { cwd: TEST_DIR });

        const result = spawnSync('node', [SCRIPT_PATH, 'search', 'architecture and design'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0, `Search failed: ${result.stderr}`);
        assert.ok(result.stdout.toLowerCase().includes('architecture'), `Search results should include "Architecture". Output: ${result.stdout}`);
        assert.ok(result.stdout.includes('test2.md'), `Search results should link to test2.md. Output: ${result.stdout}`);
    });

    it('handles search with no results gracefully', () => {
        const result = spawnSync('node', [SCRIPT_PATH, 'search', 'nonexistentkeywordxyz'], {
            cwd: TEST_DIR,
            env: { ...process.env },
            encoding: 'utf-8'
        });

        assert.equal(result.status, 0);
        assert.ok(result.stdout.includes('No semantic matches found'), 'Should report no matches');
    });
});
