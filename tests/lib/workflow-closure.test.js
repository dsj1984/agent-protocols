import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';
import { resolveWorkflowClosures } from '../../.agents/scripts/lib/workflow-closure.js';

/**
 * Unit coverage for the workflow read-tier closure resolver (Story #4752).
 *
 * Drives `resolveWorkflowClosures` against tmpdir fixtures: entry-point
 * selection, the optional source-side `mandatoryReads:` marker in both YAML
 * shapes, the mandatory/on-demand partition, the two loud failure modes
 * (unresolvable mandatory entry, mandatory cycle), and the cycle-tolerant
 * reachable walk.
 */

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Materialize a fixture repo under a fresh tmpdir. `files` maps repo-relative
 * paths to string contents. Returns the absolute root.
 */
function makeRepo(files) {
  const root = makeTempDir('wf-closure-');
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

/** Frontmatter block carrying an optional `mandatoryReads` line. */
function frontmatter(mandatoryReads) {
  const line = mandatoryReads ? `${mandatoryReads}\n` : '';
  return `---\ndescription: fixture\n${line}---\n\n`;
}

const paths = (entries) => entries.map((e) => e.path);

// ---------------------------------------------------------------------------
// Entry-point selection
// ---------------------------------------------------------------------------

test('every top-level workflow is an entry point; plain helpers are not', () => {
  const root = makeRepo({
    '.agents/workflows/plan.md': `${frontmatter()}# /plan\n\n[helper](helpers/notes.md)\n`,
    '.agents/workflows/deliver.md': `${frontmatter()}# Deliver\n`,
    '.agents/workflows/helpers/notes.md': '# Notes (helper)\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.entryPoints), [
    '.agents/workflows/deliver.md',
    '.agents/workflows/plan.md',
  ]);
});

test('a helper whose H1 declares its own slash command is an entry point, an appendix titled after another command is not', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter()}# /deliver\n`,
    '.agents/workflows/helpers/deliver-story.md':
      '# /deliver-story #[Story ID]\n',
    '.agents/workflows/helpers/deliver-reference.md':
      '# /deliver — reference appendix (on-demand)\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.entryPoints), [
    '.agents/workflows/deliver.md',
    '.agents/workflows/helpers/deliver-story.md',
  ]);
});

// ---------------------------------------------------------------------------
// mandatoryReads marker
// ---------------------------------------------------------------------------

test('an absent mandatoryReads key is not an error — the closure is the entry point alone', () => {
  const root = makeRepo({
    '.agents/workflows/plan.md': `${frontmatter()}# /plan\n\n[ref](helpers/ref.md)\n`,
    '.agents/workflows/helpers/ref.md': '# Ref\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.mandatoryFiles), [
    '.agents/workflows/plan.md',
  ]);
  assert.equal(
    closure.entryPoints[0].mandatoryBytes,
    closure.mandatoryTotalBytes,
  );
});

test('a flow-style mandatoryReads list resolves transitively', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter('mandatoryReads: [helpers/digest.md]')}# /deliver\n`,
    '.agents/workflows/helpers/digest.md': `${frontmatter('mandatoryReads: [nested.md]')}# Digest\n`,
    '.agents/workflows/helpers/nested.md': '# Nested\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.mandatoryFiles), [
    '.agents/workflows/deliver.md',
    '.agents/workflows/helpers/digest.md',
    '.agents/workflows/helpers/nested.md',
  ]);
});

test('a block-style mandatoryReads list resolves, and quoted entries are unwrapped', () => {
  const root = makeRepo({
    '.agents/workflows/plan.md': `---\ndescription: fixture\nmandatoryReads:\n  - helpers/a.md\n  - "helpers/b.md"\n---\n\n# /plan\n`,
    '.agents/workflows/helpers/a.md': '# A\n',
    '.agents/workflows/helpers/b.md': '# B\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.mandatoryFiles), [
    '.agents/workflows/helpers/a.md',
    '.agents/workflows/helpers/b.md',
    '.agents/workflows/plan.md',
  ]);
});

test('every reachable link not named in mandatoryReads is classified on-demand', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter('mandatoryReads: [helpers/digest.md]')}# /deliver\n\n[digest](helpers/digest.md) [appendix](helpers/appendix.md#step-3)\n`,
    '.agents/workflows/helpers/digest.md': '# Digest\n',
    '.agents/workflows/helpers/appendix.md': '# Appendix\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.mandatoryFiles), [
    '.agents/workflows/deliver.md',
    '.agents/workflows/helpers/digest.md',
  ]);
  assert.deepEqual(paths(closure.onDemandFiles), [
    '.agents/workflows/helpers/appendix.md',
  ]);
  assert.equal(
    closure.reachableTotalBytes,
    closure.mandatoryTotalBytes +
      closure.onDemandFiles.reduce((sum, e) => sum + e.bytes, 0),
  );
});

// ---------------------------------------------------------------------------
// Loud failure modes
// ---------------------------------------------------------------------------

test('a mandatoryReads entry naming a missing file throws, naming the workflow and the path', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter('mandatoryReads: [helpers/gone.md]')}# /deliver\n`,
  });
  assert.throws(
    () => resolveWorkflowClosures(root),
    (err) => {
      assert.match(err.message, /\.agents\/workflows\/deliver\.md/);
      assert.match(err.message, /helpers\/gone\.md/);
      return true;
    },
  );
});

test('a mandatoryReads entry pointing outside the workflow tree throws rather than silently dropping', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter('mandatoryReads: [../rules/testing-standards.md]')}# /deliver\n`,
    '.agents/rules/testing-standards.md': '# Rules\n',
  });
  assert.throws(() => resolveWorkflowClosures(root), /testing-standards\.md/);
});

test('a cycle among mandatoryReads edges throws, naming the cycle', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter('mandatoryReads: [helpers/a.md]')}# /deliver\n`,
    '.agents/workflows/helpers/a.md': `${frontmatter('mandatoryReads: [b.md]')}# A\n`,
    '.agents/workflows/helpers/b.md': `${frontmatter('mandatoryReads: [a.md]')}# B\n`,
  });
  assert.throws(
    () => resolveWorkflowClosures(root),
    (err) => {
      assert.match(err.message, /cycle/);
      assert.match(err.message, /helpers\/a\.md/);
      assert.match(err.message, /helpers\/b\.md/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Reachable walk
// ---------------------------------------------------------------------------

test('a cycle in the prose link graph terminates and counts each file exactly once', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter()}# /deliver\n\n[spine](helpers/spine.md)\n`,
    '.agents/workflows/helpers/spine.md': '# Spine\n\n[digest](digest.md)\n',
    '.agents/workflows/helpers/digest.md':
      '# Digest\n\n[back to the spine](spine.md)\n',
  });
  const closure = resolveWorkflowClosures(root);
  const reachable = [
    ...paths(closure.mandatoryFiles),
    ...paths(closure.onDemandFiles),
  ];
  assert.deepEqual(reachable.sort(), [
    '.agents/workflows/deliver.md',
    '.agents/workflows/helpers/digest.md',
    '.agents/workflows/helpers/spine.md',
  ]);
  const sizes = reachable.map((rel) => fs.statSync(path.join(root, rel)).size);
  assert.equal(
    closure.reachableTotalBytes,
    sizes.reduce((a, b) => a + b, 0),
  );
});

test('links outside the workflow tree and non-markdown links are neither followed nor recorded', () => {
  const root = makeRepo({
    '.agents/workflows/deliver.md': `${frontmatter()}# /deliver\n\n[rule](../rules/git.md) [schema](../schemas/x.json) [web](https://example.com/a.md)\n`,
    '.agents/rules/git.md': '# Git rules\n',
    '.agents/schemas/x.json': '{}\n',
  });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(paths(closure.mandatoryFiles), [
    '.agents/workflows/deliver.md',
  ]);
  assert.deepEqual(closure.onDemandFiles, []);
});

test('an absent workflow tree resolves empty and silently', () => {
  const root = makeRepo({ 'CLAUDE.md': '# root\n' });
  const closure = resolveWorkflowClosures(root);
  assert.deepEqual(closure.entryPoints, []);
  assert.deepEqual(closure.mandatoryFiles, []);
  assert.deepEqual(closure.onDemandFiles, []);
  assert.equal(closure.mandatoryTotalBytes, 0);
  assert.equal(closure.reachableTotalBytes, 0);
});
