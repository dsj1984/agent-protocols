import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  buildFrictionBody,
  checkDocsContextBridge,
  DOCS_CONTEXT_BRIDGE_MARKER,
  extractDocHeadings,
  matchChangedFilesToDocs,
  resolveConfiguredDocs,
} from '../.agents/scripts/lib/orchestration/docs-context-bridge.js';

function createFakeProvider() {
  let autoId = 1;
  const comments = new Map();
  return {
    _comments: comments,
    async getTicketComments(ticketId) {
      return comments.get(ticketId) ?? [];
    },
    async postComment(ticketId, payload) {
      const list = comments.get(ticketId) ?? [];
      const comment = { id: autoId++, body: payload.body, type: payload.type };
      list.push(comment);
      comments.set(ticketId, list);
      return comment;
    },
  };
}

describe('docs-context-bridge — extractDocHeadings', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb-headings-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts `##` lines and ignores ### / # and code fences', () => {
    const docPath = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(
      docPath,
      [
        '# Title',
        '## Orchestration Engine',
        'body',
        '### Subsection (ignored)',
        '## Ticket Hierarchy',
        '```',
        '## Fake heading in a code fence',
        '```',
        '## Testing',
      ].join('\n'),
    );
    assert.deepEqual(extractDocHeadings(docPath), [
      'Orchestration Engine',
      'Ticket Hierarchy',
      'Fake heading in a code fence',
      'Testing',
    ]);
  });

  it('returns [] for a missing doc', () => {
    assert.deepEqual(
      extractDocHeadings(path.join(tmpDir, 'does-not-exist.md')),
      [],
    );
  });
});

describe('docs-context-bridge — matchChangedFilesToDocs', () => {
  it('matches path segments against heading tokens (case-insensitive)', () => {
    const docs = [
      {
        docPath: 'docs/architecture.md',
        headings: ['Orchestration Engine', 'Ticket Hierarchy'],
      },
    ];
    const matches = matchChangedFilesToDocs({
      changedFiles: [
        '.agents/scripts/lib/orchestration/epic-runner/wave-scheduler.js',
        'lib/tickets/hierarchy.js',
        'README.md',
      ],
      docs,
    });
    // First two match (orchestration, hierarchy), README does not.
    assert.equal(matches.length, 2);
    assert.ok(matches.some((m) => m.heading === 'Orchestration Engine'));
    assert.ok(matches.some((m) => m.heading === 'Ticket Hierarchy'));
  });

  it('emits at most one match per (path, doc) pair', () => {
    const docs = [
      {
        docPath: 'docs/architecture.md',
        // Two headings both containing "orchestration" — same changed file
        // should only surface once.
        headings: ['Orchestration Engine', 'Epic Orchestration Runner'],
      },
    ];
    const matches = matchChangedFilesToDocs({
      changedFiles: ['.agents/scripts/lib/orchestration/epic-runner.js'],
      docs,
    });
    assert.equal(matches.length, 1);
  });

  it('returns [] when no path segment matches any heading token', () => {
    const docs = [{ docPath: 'docs/x.md', headings: ['Release Process'] }];
    const matches = matchChangedFilesToDocs({
      changedFiles: ['src/foo/bar.js', 'tests/baz.test.js'],
      docs,
    });
    assert.deepEqual(matches, []);
  });

  it('ignores short tokens (stop-words) on both sides', () => {
    // "of" and "it" shouldn't cause spurious matches.
    const docs = [{ docPath: 'docs/x.md', headings: ['Of It'] }];
    const matches = matchChangedFilesToDocs({
      changedFiles: ['of/it.js'],
      docs,
    });
    assert.deepEqual(matches, []);
  });
});

describe('docs-context-bridge — resolveConfiguredDocs', () => {
  it('joins release.docs at repo root and docsContextFiles under docsRoot', () => {
    const cwd = process.platform === 'win32' ? 'C:\\repo' : '/repo';
    const paths = resolveConfiguredDocs({
      cwd,
      agentSettings: {
        docsRoot: 'docs',
        release: { docs: ['README.md', 'docs/CHANGELOG.md'] },
        docsContextFiles: ['architecture.md', 'patterns.md'],
      },
    });
    // Normalize for cross-platform equality.
    const norm = paths.map((p) => p.replace(/\\/g, '/'));
    assert.ok(norm.some((p) => p.endsWith('/repo/README.md')));
    assert.ok(norm.some((p) => p.endsWith('/repo/docs/CHANGELOG.md')));
    assert.ok(norm.some((p) => p.endsWith('/repo/docs/architecture.md')));
    assert.ok(norm.some((p) => p.endsWith('/repo/docs/patterns.md')));
  });

  it('returns [] when no doc configuration is present', () => {
    assert.deepEqual(
      resolveConfiguredDocs({ cwd: '/tmp', agentSettings: {} }),
      [],
    );
  });
});

describe('docs-context-bridge — buildFrictionBody', () => {
  it('includes the marker and a row per match', () => {
    const body = buildFrictionBody({
      storyId: 454,
      matches: [
        {
          path: 'lib/foo.js',
          doc: 'docs/architecture.md',
          heading: 'Ticket Hierarchy',
        },
      ],
    });
    assert.ok(body.includes(DOCS_CONTEXT_BRIDGE_MARKER));
    assert.ok(body.includes('Story #454'));
    assert.ok(body.includes('`lib/foo.js`'));
    assert.ok(body.includes('`docs/architecture.md`'));
    assert.ok(body.includes('Ticket Hierarchy'));
  });
});

describe('docs-context-bridge — checkDocsContextBridge (integration)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb-check-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'architecture.md'),
      ['# Title', '## Orchestration Engine', '## Ticket Hierarchy'].join('\n'),
    );
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '## Release Process\n');
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const agentSettings = {
    docsRoot: 'docs',
    release: { docs: ['README.md'] },
    docsContextFiles: ['architecture.md'],
  };

  it('emits a friction comment on match', async () => {
    const provider = createFakeProvider();
    const result = await checkDocsContextBridge({
      provider,
      storyId: 454,
      changedFiles: ['.agents/lib/orchestration/epic-runner.js'],
      cwd: tmpDir,
      agentSettings,
    });
    assert.equal(result.matched, true);
    assert.equal(result.emitted, true);
    const comments = provider._comments.get(454);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].type, 'friction');
    assert.ok(comments[0].body.includes(DOCS_CONTEXT_BRIDGE_MARKER));
  });

  it('no-match case emits no comment', async () => {
    const provider = createFakeProvider();
    const result = await checkDocsContextBridge({
      provider,
      storyId: 454,
      changedFiles: ['unrelated/foo.js'],
      cwd: tmpDir,
      agentSettings,
    });
    assert.equal(result.matched, false);
    assert.equal(result.emitted, false);
    assert.equal(provider._comments.get(454), undefined);
  });

  it('dedupes: does not re-emit when a bridge comment already exists', async () => {
    const provider = createFakeProvider();
    // Pre-seed an existing bridge comment.
    await provider.postComment(454, {
      type: 'friction',
      body: `${DOCS_CONTEXT_BRIDGE_MARKER}\n\nprior run`,
    });
    const result = await checkDocsContextBridge({
      provider,
      storyId: 454,
      changedFiles: ['.agents/lib/orchestration/epic-runner.js'],
      cwd: tmpDir,
      agentSettings,
    });
    assert.equal(result.matched, true);
    assert.equal(result.emitted, false);
    assert.equal(provider._comments.get(454).length, 1);
  });

  it('returns checked:true with no emission when changedFiles is empty', async () => {
    const provider = createFakeProvider();
    const result = await checkDocsContextBridge({
      provider,
      storyId: 454,
      changedFiles: [],
      cwd: tmpDir,
      agentSettings,
    });
    assert.equal(result.matched, false);
    assert.equal(result.emitted, false);
  });
});
