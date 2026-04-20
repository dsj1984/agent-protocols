import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';
import { WorktreeManager } from '../.agents/scripts/lib/worktree-manager.js';
import { runStoryClose } from '../.agents/scripts/sprint-story-close.js';
import { runStoryInit } from '../.agents/scripts/sprint-story-init.js';
import { MockProvider } from './fixtures/mock-provider.js';

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
// Tracks branches known to exist locally so rev-parse --verify behaves
// realistically in bootstrap tri-state decisions.
const knownLocalBranches = new Set(['main']);
const knownRemoteBranches = new Set();

const mockSpawn = (cmd, args) => {
  gitHistory.push({ cmd, args, type: 'spawn' });
  // Register new branches from `checkout -b <name>` BEFORE trackBranch runs,
  // so subsequent rev-parse calls see them.
  if (args[0] === 'checkout') {
    const flagIdx = args.findIndex((a) => a === '-b' || a === '-B');
    if (flagIdx >= 0 && args[flagIdx + 1]) {
      knownLocalBranches.add(args[flagIdx + 1]);
    }
  }
  if (args[0] === 'push') {
    const branch = args[args.length - 1];
    if (branch && !branch.startsWith('-')) knownRemoteBranches.add(branch);
  }
  trackBranch(args);
  if (args.includes('--show-current')) {
    return { status: 0, stdout: currentBranch, stderr: '' };
  }
  if (args[0] === 'rev-parse' && args.includes('--verify')) {
    const ref = args[args.length - 1];
    const branch = ref.replace(/^refs\/heads\//, '');
    return {
      status: knownLocalBranches.has(branch) ? 0 : 128,
      stdout: '',
      stderr: '',
    };
  }
  if (args[0] === 'ls-remote') {
    const branch = args[args.length - 1];
    return {
      status: 0,
      stdout: knownRemoteBranches.has(branch)
        ? `abc\trefs/heads/${branch}`
        : '',
      stderr: '',
    };
  }
  if (args[0] === 'status' && args.includes('--porcelain')) {
    return { status: 0, stdout: '', stderr: '' };
  }
  return { status: 0, stdout: '', stderr: '' };
};

__setGitRunners(mockExec, mockSpawn);

test.beforeEach(() => {
  gitHistory.length = 0;
  currentBranch = 'main';
  knownLocalBranches.clear();
  knownLocalBranches.add('main');
  knownRemoteBranches.clear();
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

test('sprint-story-init: fails closed when blocker verification errors', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50\nblocked by #99',
        labels: ['type::story'],
      },
      50: { id: 50, title: 'Epic 50', labels: ['type::epic'] },
    },
  });
  provider.getTicket = async (id) => {
    if (id === 99) throw new Error('GitHub API timeout');
    if (!provider.tickets[id])
      throw new Error(`Ticket #${id} not found in mock`);
    return JSON.parse(JSON.stringify(provider.tickets[id]));
  };

  const { success, blocked, openBlockers } = await runStoryInit({
    storyId: 100,
    dryRun: false,
    injectedProvider: provider,
    injectedConfig: mockConfig,
  });

  assert.strictEqual(
    success,
    false,
    'Should fail when blocker state is unknown',
  );
  assert.strictEqual(
    blocked,
    true,
    'Unknown blocker verification should block',
  );
  assert.strictEqual(
    openBlockers.length,
    1,
    'Should surface the unverified blocker',
  );
  assert.strictEqual(openBlockers[0].id, 99);
  assert.equal(openBlockers[0].fetchError, true);
});

test('sprint-story-init: epic exists locally only → pushes to remote (no crash)', async () => {
  // Reproduces the #329 crash: epic/50 exists locally from a prior partial
  // run but not remotely. Old logic ran `checkout -b epic/50` and failed.
  knownLocalBranches.add('epic/50');

  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50',
        labels: ['type::story'],
      },
      50: { id: 50, title: 'Epic 50', labels: ['type::epic'] },
    },
    subTickets: { 100: [] },
  });

  const { success } = await runStoryInit({
    storyId: 100,
    dryRun: false,
    injectedProvider: provider,
    injectedConfig: mockConfig,
  });

  assert.ok(success, 'Should succeed when epic exists locally only');
  const checkoutCreateCalls = gitHistory.filter(
    (h) =>
      h.args[0] === 'checkout' &&
      (h.args[1] === '-b' || h.args[1] === '-B') &&
      h.args[2] === 'epic/50',
  );
  assert.strictEqual(
    checkoutCreateCalls.length,
    0,
    'Must not attempt `checkout -b epic/50` when branch already exists locally',
  );
  const pushCalls = gitHistory.filter(
    (h) => h.args[0] === 'push' && h.args.includes('epic/50'),
  );
  assert.ok(pushCalls.length > 0, 'Should publish the local-only epic branch');
});

test('sprint-story-init: refuses to switch branches when working tree is dirty', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50',
        labels: ['type::story'],
      },
      50: { id: 50, title: 'Epic 50', labels: ['type::epic'] },
    },
    subTickets: { 100: [] },
  });

  // Temporarily inject a dirty-tree response for `status --porcelain`.
  __setGitRunners(mockExec, (cmd, args) => {
    if (args[0] === 'status' && args.includes('--porcelain')) {
      return {
        status: 0,
        stdout: ' M apps/api/src/routes/v1/media/highlights.ts',
        stderr: '',
      };
    }
    return mockSpawn(cmd, args);
  });

  await assert.rejects(
    runStoryInit({
      storyId: 100,
      dryRun: false,
      injectedProvider: provider,
      injectedConfig: mockConfig,
    }),
    /Working tree is dirty/,
  );

  // Restore
  __setGitRunners(mockExec, mockSpawn);
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

  assert.strictEqual(
    success,
    false,
    'Should fail (operator decision required)',
  );
  assert.strictEqual(
    result.action,
    'paused-for-approval',
    'Should pause for operator instead of creating a PR',
  );
  assert.match(
    result.reason,
    /risk::high/,
    'Reason should cite the risk::high label',
  );
  assert.strictEqual(
    provider.comments.length,
    0,
    'Gate must not post any ticket comment — pause is in-chat only',
  );
});

test('sprint-story-close: reaps worktree using resolved --cwd repo root', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Story 100',
        body: 'Epic: #50',
        labels: ['type::story', 'agent::executing'],
      },
    },
    subTickets: {
      100: [],
    },
  });
  const explicitMainRepo = path.resolve('C:/tmp/main-repo');
  let observedRepoRoot = null;
  const originalReap = WorktreeManager.prototype.reap;
  WorktreeManager.prototype.reap = async function (_storyId, _opts) {
    observedRepoRoot = this.repoRoot;
    return {
      removed: false,
      reason: 'not-a-worktree',
      path: this.pathFor(100),
    };
  };
  try {
    const { success } = await runStoryClose({
      storyId: 100,
      cwd: explicitMainRepo,
      injectedProvider: provider,
    });
    assert.ok(success, 'Story close should still succeed');
    assert.equal(
      observedRepoRoot,
      explicitMainRepo,
      'WorktreeManager must be rooted at the runtime --cwd path',
    );
  } finally {
    WorktreeManager.prototype.reap = originalReap;
  }
});
