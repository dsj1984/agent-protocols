import test from 'node:test';
import assert from 'node:assert/strict';
import { renderManifestMarkdown } from '../../.agents/scripts/lib/presentation/manifest-renderer.js';

test('manifest-renderer: renders simple manifest', () => {
    const manifest = {
        epicId: 1,
        epicTitle: 'Epic',
        summary: 'Summary',
        storyManifest: [
            { storyId: 10, storySlug: 'story-10', tasks: [{ id: 101, title: 'T1' }], type: 'story', earliestWave: 1 }
        ],
        dryRun: true,
        generatedAt: new Date().toISOString()
    };

    const output = renderManifestMarkdown(manifest);
    assert.ok(output.includes('Epic'));
    assert.ok(output.includes('Wave 1'));
    assert.ok(output.includes('story-10'));
});
