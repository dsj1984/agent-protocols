import test from 'node:test';
import assert from 'node:assert/strict';
import { runStoryInit } from '../.agents/scripts/sprint-story-init.js';
import { runStoryClose } from '../.agents/scripts/sprint-story-close.js';
import { MockProvider } from './fixtures/mock-provider.js';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';

const gitHistory = [];
let currentBranch = 'main';

const trackBranch = (args) => {
  if (args.includes('checkout')) {
    const idx = args.indexOf('checkout');
    let branch = args[idx + 1];
    if (branch === '-b' || branch === '-B' || branch === '-t') {
      branch = args[idx + 2];
    }
    if (branch && !branch.startsWith('-')) currentBranch = branch;
  }
};

const mockExec = (cmd, args) => {
  gitHistory.push({ cmd, args, type: 'exec' });
  trackBranch(args);
  if (args.includes('ls-remote')) return 'abc story-100';
  return '';
};
const mockSpawn = (cmd, args) => {
  gitHistory.push({ cmd, args, type: 'spawn' });
  trackBranch(args);
  if (args.includes('--show-current')) {
    return { status: 0, stdout: currentBranch, stderr: '' };
  }
  return { status: 0, stdout: '', stderr: '' };
};

__setGitRunners(mockExec, mockSpawn);

test.beforeEach(() => {
  gitHistory.length = 0;
  currentBranch = 'main';
});

const mockConfig = {
  settings: { mainBranch: 'main' },
  orchestration: { provider: 'github' },
};

test('sprint-story-init: successful initialization', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50\nPRD: #51',
        labels: ['type::story'],
      },
      50: { id: 50, title: 'Epic 50', labels: ['type::epic'] },
      101: {
        id: 101,
        title: 'Task 1',
        body: 'parent: #100',
        labels: ['type::task', 'agent::ready'],
      },
      102: {
        id: 102,
        title: 'Task 2',
        body: 'parent: #100\nblocked by #101',
        labels: ['type::task', 'agent::ready'],
      },
    },
    subTickets: {
      100: [101, 102],
    },
  });

  const { success, result } = await runStoryInit({
    storyId: 100,
    dryRun: false,
    injectedProvider: provider,
    injectedConfig: mockConfig,
  });

  assert.ok(success, 'Should succeed');
  assert.equal(result.tasks.length, 2, 'Should find 2 tasks');
  assert.equal(
    result.tasks[0].id,
    101,
    'Task 1 should be first (dependency order)',
  );
  assert.equal(result.tasks[1].id, 102, 'Task 2 should be second');

  // Verify ticket updates
  const task1Updates = provider.updates.filter((u) => u.id === 101);
  assert.ok(
    task1Updates.some((u) =>
      u.mutations.labels.add.includes('agent::executing'),
    ),
    'Task 1 should be executing',
  );

  // Verify git actions
  const pullCalls = gitHistory.filter((h) => h.args.includes('pull'));
  assert.ok(pullCalls.length > 0, 'Should attempt git pull');
});

test('sprint-story-init: fails on open blockers', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50\nblocked by #99',
        labels: ['type::story'],
      },
      50: { id: 50, title: 'Epic 50', labels: ['type::epic'] },
      99: {
        id: 99,
        title: 'Prereq',
        labels: ['agent::executing'],
        state: 'open',
      },
    },
  });

  const { success, blocked, openBlockers } = await runStoryInit({
    storyId: 100,
    dryRun: false,
    injectedProvider: provider,
    injectedConfig: mockConfig,
  });

  assert.strictEqual(success, false, 'Should fail');
  assert.strictEqual(blocked, true, 'Should be flagged as blocked');
  assert.strictEqual(openBlockers.length, 1, 'Should find 1 open blocker');
  assert.strictEqual(openBlockers[0].id, 99);
});

test('sprint-story-close: successful merge and closure', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50',
        labels: ['type::story', 'agent::executing'],
      },
      101: {
        id: 101,
        title: 'Task 1',
        body: 'parent: #100',
        labels: ['type::task', 'agent::executing'],
      },
    },
    subTickets: {
      100: [101],
    },
  });

  const { success, result } = await runStoryClose({
    storyId: 100,
    injectedProvider: provider,
  });

  assert.ok(success, 'Should succeed');
  assert.strictEqual(result.merged, true, 'Should be marked as merged');

  // Verify closures
  const story = provider.tickets[100];
  const task = provider.tickets[101];
  assert.ok(story.labels.includes('agent::done'), 'Story should be done');
  assert.ok(task.labels.includes('agent::done'), 'Task should be done');
});

test('sprint-story-close: handle risk::high gate', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'High Risk Story',
        body: 'Epic: #50',
        labels: ['type::story', 'risk::high', 'agent::executing'],
      },
    },
  });

  const { success, result } = await runStoryClose({
    storyId: 100,
    injectedProvider: provider,
  });

  assert.strictEqual(success, false, 'Should fail (manual merge required)');
  assert.strictEqual(result.action, 'pr-created', 'Should have created a PR');
  assert.ok(result.prUrl.includes('/pull/123'), 'PR URL should be included');
});
