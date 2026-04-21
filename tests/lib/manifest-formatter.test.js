import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatManifestMarkdown,
  formatStoryManifestMarkdown,
  printStoryDispatchTable,
  renderManifestMarkdown,
} from '../../.agents/scripts/lib/presentation/manifest-formatter.js';

function epicManifest(overrides = {}) {
  return {
    epicId: 42,
    epicTitle: 'Demo Epic',
    dryRun: false,
    generatedAt: '2026-04-20T00:00:00.000Z',
    summary: {
      totalTasks: 4,
      doneTasks: 1,
      progressPercent: 25,
      dispatched: 2,
      heldForApproval: 0,
      totalWaves: 2,
    },
    storyManifest: [
      {
        storyId: 101,
        storySlug: 'alpha',
        storyTitle: 'Alpha Story',
        type: 'story',
        earliestWave: 0,
        model_tier: 'low',
        branchName: 'story-101',
        tasks: [
          { taskId: 201, taskSlug: 't-a1', status: 'agent::done' },
          { taskId: 202, taskSlug: 't-a2', status: 'agent::ready' },
        ],
      },
      {
        storyId: 102,
        storySlug: 'beta',
        storyTitle: 'Beta Story',
        type: 'story',
        earliestWave: 1,
        model_tier: 'high',
        branchName: 'story-102',
        tasks: [
          {
            taskId: 203,
            taskSlug: 't-b1',
            status: 'agent::ready',
            dependencies: [201],
          },
          { taskId: 204, taskSlug: 't-b2', status: 'agent::ready' },
        ],
      },
    ],
    ...overrides,
  };
}

test('formatter: renders epic header, progress, wave table, details', () => {
  const md = formatManifestMarkdown(epicManifest());
  assert.ok(md.includes('# 📋 Dispatch Manifest — Epic #42'));
  assert.ok(md.includes('> **Demo Epic**'));
  assert.ok(md.includes('## Wave Summary'));
  assert.ok(md.includes('Wave 0'));
  assert.ok(md.includes('Wave 1'));
  assert.ok(md.includes('## Story Details'));
  assert.ok(md.includes('Story #101: alpha'));
  assert.ok(md.includes('[x] **#201**'));
  assert.ok(md.includes('[ ] **#203** — t-b1 _(blocked by: #201)_'));
});

test('formatter: live vs dry-run label', () => {
  assert.ok(
    formatManifestMarkdown(epicManifest({ dryRun: true })).includes(
      '🔍 Dry Run',
    ),
  );
  assert.ok(
    formatManifestMarkdown(epicManifest({ dryRun: false })).includes(
      '🚀 Live Dispatch',
    ),
  );
});

test('formatter: feature containers row when features present', () => {
  const manifest = epicManifest();
  manifest.storyManifest.push({
    storyId: 300,
    storySlug: 'container',
    type: 'feature',
    earliestWave: -1,
    branchName: 'feature-300',
    model_tier: 'low',
    tasks: [{ taskId: 400, taskSlug: 'orphan', status: 'agent::ready' }],
  });
  const md = formatManifestMarkdown(manifest);
  assert.ok(md.includes('## Feature Containers'));
  assert.ok(md.includes('#300'));
  assert.ok(md.includes('Features (containers) | 1'));
});

test('formatter: renderManifestMarkdown alias matches formatManifestMarkdown', () => {
  const manifest = epicManifest();
  assert.equal(renderManifestMarkdown(manifest), formatManifestMarkdown(manifest));
});

test('formatter: story execution manifest respects injected settings', () => {
  const md = formatStoryManifestMarkdown(
    {
      generatedAt: '2026-04-20T00:00:00.000Z',
      stories: [
        {
          storyId: 101,
          storyTitle: 'Alpha',
          epicBranch: 'epic/42',
          branchName: 'story-101',
          model_tier: 'low',
          tasks: [
            {
              taskId: 201,
              title: 'Do the thing',
              status: 'agent::ready',
              dependencies: [],
            },
          ],
        },
      ],
    },
    {
      settings: {
        scriptsRoot: 'custom/scripts',
        validationCommand: 'npm run check',
        testCommand: 'npm run spec',
      },
    },
  );
  assert.ok(md.includes('custom/scripts/sprint-story-init.js'));
  assert.ok(md.includes('Run `npm run check` and `npm run spec`'));
});

test('formatter: story execution manifest falls back to defaults when settings absent', () => {
  const md = formatStoryManifestMarkdown({
    generatedAt: '2026-04-20T00:00:00.000Z',
    stories: [],
  });
  assert.ok(md.includes('.agents/scripts/sprint-story-init.js'));
  assert.ok(md.includes('npm run lint'));
  assert.ok(md.includes('npm test'));
});

test('formatter: printStoryDispatchTable writes to injected logger', () => {
  const lines = [];
  const logger = { log: (line) => lines.push(line) };
  printStoryDispatchTable(
    [
      {
        storyId: 101,
        storySlug: 'alpha',
        type: 'story',
        earliestWave: 0,
        model_tier: 'low',
        tasks: [{}, {}],
      },
      {
        storyId: 200,
        storySlug: 'container',
        type: 'feature',
        earliestWave: -1,
        model_tier: 'low',
        tasks: [{}],
      },
    ],
    { logger },
  );
  const flat = lines.join('\n');
  assert.ok(flat.includes('📋 STORY DISPATCH TABLE'));
  assert.ok(flat.includes('#101'));
  assert.ok(flat.includes('📦 Feature Containers'));
});

test('formatter: printStoryDispatchTable no-ops on empty manifest', () => {
  const lines = [];
  const logger = { log: (line) => lines.push(line) };
  printStoryDispatchTable([], { logger });
  assert.equal(lines.length, 0);
});
