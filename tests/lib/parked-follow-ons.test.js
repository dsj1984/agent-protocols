import assert from 'node:assert';
import { test } from 'node:test';
import {
  classifyStoriesAgainstManifest,
  renderParkedFollowOnsComment,
} from '../../.agents/scripts/lib/orchestration/parked-follow-ons.js';

function mkStory(
  id,
  { body = '', state = 'open', title = `Story ${id}` } = {},
) {
  return { id, body, state, title, labels: ['type::story'] };
}

test('classify - sorts stories into manifest / recut / parked buckets', () => {
  const manifestIds = [100, 101];
  const stories = [
    mkStory(100),
    mkStory(101),
    mkStory(200, { body: '<!-- recut-of: #100 -->' }),
    mkStory(201),
    mkStory(202, { body: '<!-- recut-of: #999 -->' }),
  ];
  const { manifest, recuts, parked } = classifyStoriesAgainstManifest(
    manifestIds,
    stories,
  );
  assert.deepStrictEqual(
    manifest.map((s) => s.id),
    [100, 101],
  );
  assert.deepStrictEqual(
    recuts.map((r) => [r.storyId, r.parentId]),
    [[200, 100]],
  );
  assert.deepStrictEqual(
    parked.map((p) => p.storyId),
    [201, 202],
  );
});

test('classify - empty stories list returns empty buckets', () => {
  const out = classifyStoriesAgainstManifest([1, 2], []);
  assert.deepStrictEqual(out, { manifest: [], recuts: [], parked: [] });
});

test('render - includes tables and JSON block for gate parsing', () => {
  const classification = {
    manifest: [],
    recuts: [{ storyId: 200, parentId: 100, title: 'recut', state: 'open' }],
    parked: [{ storyId: 201, title: 'parked', state: 'open' }],
  };
  const body = renderParkedFollowOnsComment(42, classification);
  assert.match(body, /Epic #42/);
  assert.match(body, /### Recuts/);
  assert.match(body, /### Parked Follow-Ons/);
  assert.match(body, /```json/);
  const fence = body.match(/```json\s*\n([\s\S]*?)\n```/);
  assert.ok(fence, 'JSON block must be parseable');
  const parsed = JSON.parse(fence[1]);
  assert.deepStrictEqual(parsed.recuts, [
    { storyId: 200, parentId: 100, state: 'open' },
  ]);
  assert.deepStrictEqual(parsed.parked, [{ storyId: 201, state: 'open' }]);
});

test('render - shows success line when no out-of-manifest stories', () => {
  const body = renderParkedFollowOnsComment(7, {
    manifest: [],
    recuts: [],
    parked: [],
  });
  assert.match(body, /No out-of-manifest Stories/);
});
