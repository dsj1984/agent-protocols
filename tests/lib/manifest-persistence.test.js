import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { persistManifest } from '../../.agents/scripts/lib/presentation/manifest-persistence.js';

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-persist-'));
}

test('persistence: writes dispatch-manifest json + md for Epic manifest', () => {
  const root = makeTmpRoot();
  const manifest = {
    epicId: 77,
    epicTitle: 'Epic Seventy-Seven',
    dryRun: false,
    generatedAt: '2026-04-20T00:00:00.000Z',
    summary: {
      totalTasks: 1,
      doneTasks: 0,
      progressPercent: 0,
      dispatched: 0,
      heldForApproval: 0,
      totalWaves: 1,
    },
    storyManifest: [
      {
        storyId: 1,
        storySlug: 's1',
        type: 'story',
        earliestWave: 0,
        model_tier: 'low',
        branchName: 'story-1',
        tasks: [{ taskId: 10, taskSlug: 't', status: 'agent::ready' }],
      },
    ],
  };
  persistManifest(manifest, { projectRoot: root });
  const mdPath = path.join(root, 'temp', 'dispatch-manifest-77.md');
  const jsonPath = path.join(root, 'temp', 'dispatch-manifest-77.json');
  assert.ok(fs.existsSync(mdPath), 'dispatch-manifest-77.md missing');
  assert.ok(fs.existsSync(jsonPath), 'dispatch-manifest-77.json missing');
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.ok(md.includes('Dispatch Manifest — Epic #77'));
});

test('persistence: writes story-manifest json + md for story-execution manifest', () => {
  const root = makeTmpRoot();
  const manifest = {
    type: 'story-execution',
    generatedAt: '2026-04-20T00:00:00.000Z',
    stories: [
      {
        storyId: 42,
        storyTitle: 'Forty-Two',
        epicBranch: 'epic/99',
        branchName: 'story-42',
        model_tier: 'high',
        tasks: [{ taskId: 100, title: 'Do it', status: 'agent::ready' }],
      },
    ],
  };
  persistManifest(manifest, {
    projectRoot: root,
    settings: {
      scriptsRoot: '.agents/scripts',
      validationCommand: 'npm run lint',
      testCommand: 'npm test',
    },
  });
  const mdPath = path.join(root, 'temp', 'story-manifest-42.md');
  const jsonPath = path.join(root, 'temp', 'story-manifest-42.json');
  assert.ok(fs.existsSync(mdPath), 'story-manifest-42.md missing');
  assert.ok(fs.existsSync(jsonPath), 'story-manifest-42.json missing');
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.ok(md.includes('Story #42'));
  assert.ok(md.includes('.agents/scripts/sprint-story-init.js'));
});

test('persistence: creates temp dir if missing', () => {
  const root = makeTmpRoot();
  assert.ok(!fs.existsSync(path.join(root, 'temp')));
  persistManifest(
    {
      epicId: 1,
      epicTitle: 'e',
      dryRun: false,
      generatedAt: 'now',
      summary: {
        totalTasks: 0,
        doneTasks: 0,
        progressPercent: 0,
        dispatched: 0,
        heldForApproval: 0,
        totalWaves: 0,
      },
      storyManifest: [],
    },
    { projectRoot: root },
  );
  assert.ok(fs.existsSync(path.join(root, 'temp')));
});

test('persistence: no-op for manifest with neither story-execution type nor epicId', () => {
  const root = makeTmpRoot();
  persistManifest({ generatedAt: 'x' }, { projectRoot: root });
  const tempDir = path.join(root, 'temp');
  if (fs.existsSync(tempDir)) {
    assert.deepEqual(fs.readdirSync(tempDir), []);
  }
});

test('persistence: swallows fs failure and writes to stderr', () => {
  // Pointing at an invalid root forces fs.mkdirSync to fail; function must
  // not throw.
  const originalWrite = process.stderr.write;
  const captured = [];
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    assert.doesNotThrow(() =>
      persistManifest(
        {
          epicId: 1,
          epicTitle: 'e',
          dryRun: false,
          generatedAt: 'now',
          summary: {
            totalTasks: 0,
            doneTasks: 0,
            progressPercent: 0,
            dispatched: 0,
            heldForApproval: 0,
            totalWaves: 0,
          },
          storyManifest: [],
        },
        { projectRoot: '\0/invalid' },
      ),
    );
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.ok(captured.some((s) => s.includes('Failed to persist manifest')));
});
