import { test } from 'node:test';
import assert from 'node:assert';
import { renderManifestMarkdown } from '../.agents/scripts/lib/presentation/manifest-renderer.js';

test('manifest-renderer', async (t) => {
  await t.test('renders empty manifest correctly', () => {
    const manifest = {
      epicId: 100,
      epicTitle: 'Test Epic',
      summary: { totalWaves: 0, dispatched: 0 },
      storyManifest: [],
      waves: [],
    };
    const output = renderManifestMarkdown(manifest);
    assert.match(output, /Dispatch Manifest — Epic #100/);
  });
});
