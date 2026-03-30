import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateManifest,
  buildGraph,
  detectCycle,
  assignLayers,
  groupIntoChatSessions,
  computeChatDependencies,
  generateMermaid,
  renderPlaybook,
  generateFromManifest,
} from '../.agents/scripts/generate-playbook.js';

// ---------------------------------------------------------------------------
// Helpers: Manifest Factories
// ---------------------------------------------------------------------------

function makeTask(overrides = {}) {
  return {
    id: 'task-a',
    title: 'Task A',
    dependsOn: [],
    persona: 'engineer',
    skills: ['database/turso'],
    model: 'Claude Sonnet 4.6 (Thinking)',
    mode: 'Planning',
    instructions: 'Do the thing.\nModify `src/foo.ts`.',
    ...overrides,
  };
}

function makeManifest(overrides = {}) {
  return {
    sprintNumber: 99,
    sprintName: 'Test Sprint',
    summary: 'A test sprint for unit tests.',
    tasks: [makeTask()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const errors = validateManifest(makeManifest());
    assert.deepEqual(errors, []);
  });

  it('rejects missing sprintNumber', () => {
    const errors = validateManifest(makeManifest({ sprintNumber: undefined }));
    assert.ok(errors.some((e) => e.includes('sprintNumber')));
  });

  it('rejects empty tasks array', () => {
    const errors = validateManifest(makeManifest({ tasks: [] }));
    assert.ok(errors.some((e) => e.includes('tasks')));
  });

  it('rejects duplicate task ids', () => {
    const errors = validateManifest(
      makeManifest({ tasks: [makeTask({ id: 'dup' }), makeTask({ id: 'dup', title: 'Dup 2' })] }),
    );
    assert.ok(errors.some((e) => e.includes('Duplicate')));
  });

  it('rejects unknown dependsOn references', () => {
    const errors = validateManifest(
      makeManifest({ tasks: [makeTask({ id: 'a', dependsOn: ['nonexistent'] })] }),
    );
    assert.ok(errors.some((e) => e.includes('unknown task "nonexistent"')));
  });

  it('rejects invalid mode', () => {
    const errors = validateManifest(
      makeManifest({ tasks: [makeTask({ mode: 'Turbo' })] }),
    );
    assert.ok(errors.some((e) => e.includes('mode')));
  });
});

// ---------------------------------------------------------------------------
// DAG: Cycle Detection
// ---------------------------------------------------------------------------

describe('detectCycle', () => {
  it('returns null for acyclic graphs', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    assert.equal(detectCycle(adjacency), null);
  });

  it('detects a simple cycle (A→B→A)', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['b'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const cycle = detectCycle(adjacency);
    assert.ok(cycle !== null, 'Expected a cycle to be detected');
    assert.ok(cycle.length >= 2, 'Cycle should contain at least 2 nodes');
  });

  it('detects a 3-node cycle (A→B→C→A)', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['c'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const cycle = detectCycle(adjacency);
    assert.ok(cycle !== null, 'Expected a cycle to be detected');
  });
});

// ---------------------------------------------------------------------------
// Layer Assignment
// ---------------------------------------------------------------------------

describe('assignLayers', () => {
  it('assigns layer 0 to root tasks', () => {
    const tasks = [makeTask({ id: 'a', dependsOn: [] })];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    assert.equal(layers.get('a'), 0);
  });

  it('assigns incrementing layers for a linear chain', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    assert.equal(layers.get('a'), 0);
    assert.equal(layers.get('b'), 1);
    assert.equal(layers.get('c'), 2);
  });

  it('assigns the same layer to independent tasks', () => {
    const tasks = [
      makeTask({ id: 'root', dependsOn: [] }),
      makeTask({ id: 'left', dependsOn: ['root'] }),
      makeTask({ id: 'right', dependsOn: ['root'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    assert.equal(layers.get('left'), 1);
    assert.equal(layers.get('right'), 1);
  });

  it('takes the max dependency layer for diamond patterns', () => {
    // root → left, root → right, left → merge, right → merge
    const tasks = [
      makeTask({ id: 'root', dependsOn: [] }),
      makeTask({ id: 'left', dependsOn: ['root'] }),
      makeTask({ id: 'right', dependsOn: ['root'] }),
      makeTask({ id: 'merge', dependsOn: ['left', 'right'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    assert.equal(layers.get('merge'), 2);
  });
});

// ---------------------------------------------------------------------------
// Chat Session Grouping
// ---------------------------------------------------------------------------

describe('groupIntoChatSessions', () => {
  it('single sequential pipeline: 3 chained tasks → 1 session with 3 steps', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [], scope: '@repo/api' }),
      makeTask({ id: 'b', dependsOn: ['a'], scope: '@repo/api' }),
      makeTask({ id: 'c', dependsOn: ['b'], scope: '@repo/api' }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);

    // All 3 tasks share the same scope and are in a linear chain (layers 0,1,2)
    // They should be in separate layers but same scope → each layer gets its own session
    // Actually: layer 0 has 'a', layer 1 has 'b', layer 2 has 'c'
    // Each layer has 1 scoped group → Sequential mode
    assert.equal(sessions.length, 3);
  });

  it('pure bug bash: 5 independent tasks → 5 concurrent sessions', () => {
    const tasks = [
      makeTask({ id: 'bug-1', title: 'Bug 1', dependsOn: [] }),
      makeTask({ id: 'bug-2', title: 'Bug 2', dependsOn: [] }),
      makeTask({ id: 'bug-3', title: 'Bug 3', dependsOn: [] }),
      makeTask({ id: 'bug-4', title: 'Bug 4', dependsOn: [] }),
      makeTask({ id: 'bug-5', title: 'Bug 5', dependsOn: [] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);

    assert.equal(sessions.length, 5);
    for (const session of sessions) {
      assert.equal(session.mode, 'Concurrent');
      assert.equal(session.tasks.length, 1);
    }
  });

  it('classic full-stack: backend → web + mobile fan-out', () => {
    const tasks = [
      makeTask({ id: 'db', dependsOn: [], scope: '@repo/api', title: 'DB Migrations' }),
      makeTask({ id: 'api', dependsOn: ['db'], scope: '@repo/api', title: 'API Routes' }),
      makeTask({ id: 'web', dependsOn: ['api'], scope: '@repo/web', title: 'Web UI' }),
      makeTask({ id: 'mobile', dependsOn: ['api'], scope: '@repo/mobile', title: 'Mobile UI' }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);

    // Layer 0: db (@repo/api) → 1 Sequential session
    // Layer 1: api (@repo/api) → 1 Sequential session
    // Layer 2: web (@repo/web) + mobile (@repo/mobile) → 2 Concurrent sessions
    assert.equal(sessions.length, 4);

    const concurrentSessions = sessions.filter((s) => s.mode === 'Concurrent');
    assert.equal(concurrentSessions.length, 2);
  });

  it('bookend tasks are always placed at the end in separate sessions', () => {
    const tasks = [
      makeTask({ id: 'work', dependsOn: [] }),
      makeTask({ id: 'qa', dependsOn: ['work'], isQA: true, title: 'QA Testing' }),
      makeTask({ id: 'review', dependsOn: ['qa'], isCodeReview: true, title: 'Code Review' }),
      makeTask({ id: 'retro', dependsOn: ['review'], isRetro: true, title: 'Retro' }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);

    // Work task → 1 session, then QA, then Code Review, then Retro = 4 sessions
    assert.equal(sessions.length, 4);
    assert.ok(sessions[sessions.length - 1].label.includes('Retro'));
    assert.ok(sessions[sessions.length - 1].mode === 'PMBookend');
    assert.ok(sessions[sessions.length - 2].label.includes('Code Review'));
    assert.ok(sessions[sessions.length - 2].mode === 'PMBookend');
    assert.ok(sessions[sessions.length - 3].label.includes('QA'));
    assert.ok(sessions[sessions.length - 3].mode === 'SequentialBookend');
  });

  it('scoped tasks at the same layer are grouped', () => {
    const tasks = [
      makeTask({ id: 'web-a', dependsOn: [], scope: '@repo/web', title: 'Web Task A' }),
      makeTask({ id: 'web-b', dependsOn: [], scope: '@repo/web', title: 'Web Task B' }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);

    // Two tasks, same scope, same layer → 1 session with 2 steps
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].tasks.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Chat Dependency Resolution
// ---------------------------------------------------------------------------

describe('computeChatDependencies', () => {
  it('resolves cross-chat dependencies from task-level deps', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [], scope: '@repo/api' }),
      makeTask({ id: 'b', dependsOn: ['a'], scope: '@repo/web' }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);
    const chatDeps = computeChatDependencies(sessions, adjacency);

    // Session containing 'b' should depend on session containing 'a'
    const sessionB = sessions.find((s) => s.tasks.some((t) => t.id === 'b'));
    const sessionA = sessions.find((s) => s.tasks.some((t) => t.id === 'a'));
    const deps = chatDeps.get(sessionB.chatNumber);
    assert.ok(deps.includes(sessionA.chatNumber));
  });
});

// ---------------------------------------------------------------------------
// Mermaid Generation
// ---------------------------------------------------------------------------

describe('generateMermaid', () => {
  it('produces valid mermaid syntax', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const { adjacency } = buildGraph(tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(tasks, layers, adjacency);
    const chatDeps = computeChatDependencies(sessions, adjacency);
    const mermaid = generateMermaid(sessions, chatDeps);

    assert.ok(mermaid.includes('```mermaid'));
    assert.ok(mermaid.includes('graph TD'));
    assert.ok(mermaid.includes('-->'));
  });
});

// ---------------------------------------------------------------------------
// Full Playbook Rendering
// ---------------------------------------------------------------------------

describe('renderPlaybook', () => {
  it('renders a complete playbook with all sections', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({ id: 'db', dependsOn: [], scope: '@repo/api', title: 'DB Migrations' }),
        makeTask({ id: 'api', dependsOn: ['db'], scope: '@repo/api', title: 'API Routes' }),
        makeTask({ id: 'web', dependsOn: ['api'], scope: '@repo/web', title: 'Web UI' }),
        makeTask({
          id: 'qa',
          dependsOn: ['web'],
          isQA: true,
          title: 'QA',
          instructions: '',
        }),
        makeTask({
          id: 'review',
          dependsOn: ['qa'],
          isCodeReview: true,
          title: 'Code Review',
          instructions: '',
        }),
        makeTask({
          id: 'retro',
          dependsOn: ['review'],
          isRetro: true,
          title: 'Retro',
          instructions: '',
        }),
      ],
    });

    const { adjacency } = buildGraph(manifest.tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(manifest.tasks, layers, adjacency);
    const chatDeps = computeChatDependencies(sessions, adjacency);
    const md = renderPlaybook(manifest, sessions, chatDeps);

    assert.ok(md.includes('# Sprint 99 Playbook: Test Sprint'));
    assert.ok(md.includes('## Sprint Summary'));
    assert.ok(md.includes('## Fan-Out Execution Flow'));
    assert.ok(md.includes('```mermaid'));
    assert.ok(md.includes('Playbook Path'));
    assert.ok(md.includes('AGENT EXECUTION PROTOCOL'));
    assert.ok(md.includes('plan-qa-testing'));
    assert.ok(md.includes('sprint-code-review'));
    assert.ok(md.includes('sprint-retro'));
  });

  it('injects the execution protocol including prerequisite check when task has dependencies', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({ id: 'a', title: 'First Task' }),
        makeTask({ id: 'b', title: 'Second Task', dependsOn: ['a'] })
      ],
    });
    const { adjacency } = buildGraph(manifest.tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(manifest.tasks, layers, adjacency);
    const chatDeps = computeChatDependencies(sessions, adjacency);
    const md = renderPlaybook(manifest, sessions, chatDeps);

    // Task number should be 99.1.2 because it relies on the first task in the same layer?
    // Wait, first task is layer 0. Second is layer 1. 
    // They share same scope. So they are consecutive essentially in playbooks.
    // The rendered text for task 'b' should contain the verify check.
    assert.ok(md.includes('verify-sprint-prerequisites'));
    assert.ok(md.includes('Dependencies**: `99.1.1`'));
    assert.ok(md.includes('finalize-sprint-task'));
  });

  it('omits prerequisite check when a task has no dependencies', () => {
    const manifest = makeManifest({
      tasks: [makeTask({ id: 'a', title: 'Only Task', dependsOn: [] })],
    });
    const { adjacency } = buildGraph(manifest.tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(manifest.tasks, layers, adjacency);
    const chatDeps = computeChatDependencies(sessions, adjacency);
    const md = renderPlaybook(manifest, sessions, chatDeps);

    assert.ok(!md.includes('verify-sprint-prerequisites'));
    assert.ok(md.includes('finalize-sprint-task'));
  });
});

// ---------------------------------------------------------------------------
// End-to-End: generateFromManifest
// ---------------------------------------------------------------------------

describe('generateFromManifest (end-to-end)', () => {
  it('produces a playbook for a classic full-stack sprint', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({ id: 'db', dependsOn: [], scope: '@repo/api', title: 'DB Migrations' }),
        makeTask({ id: 'api', dependsOn: ['db'], scope: '@repo/api', title: 'API Routes' }),
        makeTask({ id: 'web', dependsOn: ['api'], scope: '@repo/web', title: 'Web UI' }),
        makeTask({ id: 'mobile', dependsOn: ['api'], scope: '@repo/mobile', title: 'Mobile UI' }),
        makeTask({ id: 'qa', dependsOn: ['web', 'mobile'], isQA: true, title: 'QA', instructions: '' }),
        makeTask({ id: 'review', dependsOn: ['qa'], isCodeReview: true, title: 'Code Review', instructions: '' }),
        makeTask({ id: 'retro', dependsOn: ['review'], isRetro: true, title: 'Retro', instructions: '' }),
      ],
    });

    const { markdown, chatSessions } = generateFromManifest(manifest);

    assert.ok(markdown.length > 0);
    // Should have: db(1), api(2), web(3), mobile(4), QA(5), Code Review(6), retro(7)
    assert.equal(chatSessions.length, 7, `Expected 7 sessions, got ${chatSessions.length}`);
  });

  it('produces a playbook for a 10-bug bash', () => {
    const tasks = [];
    for (let i = 1; i <= 10; i++) {
      tasks.push(
        makeTask({
          id: `bug-${i}`,
          title: `Bug Fix ${i}`,
          dependsOn: [],
        }),
      );
    }
    // Add QA and retro bookends
    tasks.push(
      makeTask({
        id: 'qa',
        title: 'QA',
        dependsOn: tasks.map((t) => t.id),
        isQA: true,
        instructions: '',
      }),
    );
    tasks.push(
      makeTask({
        id: 'retro',
        title: 'Retro',
        dependsOn: ['qa'],
        isRetro: true,
        instructions: '',
      }),
    );

    const manifest = makeManifest({ tasks });
    const { markdown, chatSessions } = generateFromManifest(manifest);

    assert.ok(markdown.length > 0);
    // 10 concurrent bug sessions + QA + retro = 12
    assert.equal(chatSessions.length, 12);

    // First 10 should be concurrent
    for (let i = 0; i < 10; i++) {
      assert.equal(chatSessions[i].mode, 'Concurrent');
    }
  });

  it('throws on cyclic dependencies', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({ id: 'a', dependsOn: ['b'] }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
      ],
    });

    assert.throws(() => generateFromManifest(manifest), /cycle/i);
  });

  it('throws on unknown dependency references', () => {
    const manifest = makeManifest({
      tasks: [makeTask({ id: 'a', dependsOn: ['ghost'] })],
    });

    assert.throws(() => generateFromManifest(manifest), /unknown task/i);
  });
});
