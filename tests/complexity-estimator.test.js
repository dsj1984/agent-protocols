import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTask,
  splitTask,
  analyzeAndSplit,
} from '../.agents/scripts/lib/ComplexityEstimator.js';

// ---------------------------------------------------------------------------
// Helpers
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
    instructions: 'Do the thing.',
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

const DEFAULT_CONFIG = {
  maxComplexityScore: 8,
  instructionLengthBreakpoints: [800, 1600, 2400],
  estimatedFilesBreakpoints: [5, 10, 20],
  focusAreasBreakpoints: [3, 6],
  enableAutoSplit: true,
  enableComplexityWarnings: true,
  maxSubstepsPerTask: 5,
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('scoreTask', () => {
  it('returns 0 for a simple task', () => {
    const { total } = scoreTask(makeTask(), DEFAULT_CONFIG);
    assert.equal(total, 0);
  });

  it('skips bookend tasks', () => {
    const { total, breakdown } = scoreTask(
      makeTask({ isIntegration: true }),
      DEFAULT_CONFIG,
    );
    assert.equal(total, 0);
    assert.equal(breakdown.bookend, 'skipped');
  });

  it('scores instruction length: 1 point for >800 chars', () => {
    const { total, breakdown } = scoreTask(
      makeTask({ instructions: 'x'.repeat(801) }),
      DEFAULT_CONFIG,
    );
    assert.ok(total >= 1);
    assert.equal(breakdown.instructionLength.score, 1);
  });

  it('scores instruction length: 2 points for >1600 chars', () => {
    const { total, breakdown } = scoreTask(
      makeTask({ instructions: 'x'.repeat(1601) }),
      DEFAULT_CONFIG,
    );
    assert.ok(total >= 2);
    assert.equal(breakdown.instructionLength.score, 2);
  });

  it('scores instruction length: 3 points for >2400 chars', () => {
    const { breakdown } = scoreTask(
      makeTask({ instructions: 'x'.repeat(2401) }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.instructionLength.score, 3);
  });

  it('scores estimatedFiles: 1 point for >5 files', () => {
    const { breakdown } = scoreTask(
      makeTask({ estimatedFiles: 6 }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.estimatedFiles.score, 1);
  });

  it('scores estimatedFiles: 3 points for >20 files', () => {
    const { breakdown } = scoreTask(
      makeTask({ estimatedFiles: 25 }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.estimatedFiles.score, 3);
  });

  it('scores root scope: +2 points', () => {
    const { breakdown } = scoreTask(
      makeTask({ scope: 'root' }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.rootScope.score, 2);
  });

  it('scores focusAreas: 1 point for >3 areas', () => {
    const { breakdown } = scoreTask(
      makeTask({ focusAreas: ['a', 'b', 'c', 'd'] }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.focusAreas.score, 1);
  });

  it('scores focusAreas: 2 points for >6 areas', () => {
    const { breakdown } = scoreTask(
      makeTask({ focusAreas: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.focusAreas.score, 2);
  });

  it('scores cross-package language: +1 point', () => {
    const { breakdown } = scoreTask(
      makeTask({ instructions: 'Apply changes across all packages in the monorepo.' }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.crossPackage.score, 1);
  });

  it('scores bullet count: +1 for >5 bullets', () => {
    const bullets = Array.from({ length: 7 }, (_, i) => `- Step ${i + 1}`).join('\n');
    const { breakdown } = scoreTask(
      makeTask({ instructions: bullets }),
      DEFAULT_CONFIG,
    );
    assert.equal(breakdown.bulletCount.score, 1);
  });

  it('accumulates multiple signals correctly', () => {
    const { total } = scoreTask(
      makeTask({
        instructions: 'x'.repeat(1700) + '\nApply changes across all packages.',
        estimatedFiles: 15,
        scope: 'root',
        focusAreas: ['a', 'b', 'c', 'd', 'e'],
      }),
      DEFAULT_CONFIG,
    );
    // instructionLength: 2, estimatedFiles: 2, rootScope: 2, focusAreas: 1, crossPackage: 1 = 8
    assert.ok(total >= 8, `Expected >=8 but got ${total}`);
  });
});

// ---------------------------------------------------------------------------
// splitTask
// ---------------------------------------------------------------------------

describe('splitTask', () => {
  it('creates N sub-tasks from substeps array', () => {
    const task = makeTask({ id: 'big-task', dependsOn: ['dep-a'] });
    const substeps = [
      { title: 'Schema Changes', instructions: 'Add new columns.' },
      { title: 'API Routes', instructions: 'Add CRUD endpoints.' },
      { title: 'Tests', instructions: 'Write Vitest assertions.' },
    ];
    const subTasks = splitTask(task, substeps);

    assert.equal(subTasks.length, 3);
    assert.equal(subTasks[0].id, 'big-task-part-1');
    assert.equal(subTasks[1].id, 'big-task-part-2');
    assert.equal(subTasks[2].id, 'big-task-part-3');
  });

  it('chains sub-tasks sequentially', () => {
    const task = makeTask({ id: 'big', dependsOn: ['root'] });
    const substeps = [
      { title: 'A', instructions: 'Step A' },
      { title: 'B', instructions: 'Step B' },
    ];
    const subTasks = splitTask(task, substeps);

    // First sub-task inherits parent's dependencies
    assert.deepEqual(subTasks[0].dependsOn, ['root']);
    // Second sub-task depends on the first
    assert.deepEqual(subTasks[1].dependsOn, ['big-part-1']);
  });

  it('inherits parent metadata', () => {
    const task = makeTask({
      id: 'big',
      persona: 'architect',
      skills: ['devops/git-flow-specialist'],
      model: 'Claude Opus 4.6 (Thinking)',
      mode: 'Planning',
      scope: '@repo/api',
    });
    const subTasks = splitTask(task, [
      { title: 'Part 1', instructions: 'Do A' },
    ]);

    assert.equal(subTasks[0].persona, 'architect');
    assert.deepEqual(subTasks[0].skills, ['devops/git-flow-specialist']);
    assert.equal(subTasks[0].model, 'Claude Opus 4.6 (Thinking)');
    assert.equal(subTasks[0].scope, '@repo/api');
  });

  it('allows scope override per substep', () => {
    const task = makeTask({ id: 'big', scope: '@repo/api' });
    const subTasks = splitTask(task, [
      { title: 'API', instructions: 'A', scope: '@repo/api' },
      { title: 'Web', instructions: 'B', scope: '@repo/web' },
    ]);

    assert.equal(subTasks[0].scope, '@repo/api');
    assert.equal(subTasks[1].scope, '@repo/web');
  });

  it('sets _parentBranchId so sub-tasks share the parent branch', () => {
    const task = makeTask({ id: 'big-refactor' });
    const subTasks = splitTask(task, [
      { title: 'Part 1', instructions: 'A' },
      { title: 'Part 2', instructions: 'B' },
    ]);

    assert.equal(subTasks[0]._parentBranchId, 'big-refactor');
    assert.equal(subTasks[1]._parentBranchId, 'big-refactor');
  });

  it('sets _splitFrom metadata for rendering', () => {
    const task = makeTask({ id: 'big' });
    const subTasks = splitTask(task, [
      { title: 'P1', instructions: 'A' },
      { title: 'P2', instructions: 'B' },
      { title: 'P3', instructions: 'C' },
    ]);

    assert.equal(subTasks[0]._splitFrom, 'big');
    assert.equal(subTasks[0]._splitIndex, 1);
    assert.equal(subTasks[0]._splitTotal, 3);
    assert.equal(subTasks[2]._splitIndex, 3);
  });
});

// ---------------------------------------------------------------------------
// analyzeAndSplit
// ---------------------------------------------------------------------------

describe('analyzeAndSplit', () => {
  it('does nothing for low-complexity tasks', () => {
    const manifest = makeManifest();
    const { splits, warnings } = analyzeAndSplit(manifest, DEFAULT_CONFIG);

    assert.equal(splits.length, 0);
    assert.equal(warnings.length, 0);
    assert.equal(manifest.tasks.length, 1);
  });

  it('splits a high-complexity task with explicit substeps', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'complex-task',
          instructions: 'x'.repeat(2500),
          estimatedFiles: 25,
          scope: 'root',
          substeps: [
            { title: 'Schema', instructions: 'Modify schema files.' },
            { title: 'API', instructions: 'Update API routes.' },
            { title: 'Tests', instructions: 'Write tests.' },
          ],
        }),
      ],
    });

    const { splits, warnings } = analyzeAndSplit(manifest, DEFAULT_CONFIG);

    assert.equal(splits.length, 1, 'Expected 1 split');
    assert.equal(warnings.length, 0);
    assert.equal(manifest.tasks.length, 3, 'Should have 3 sub-tasks');
    assert.equal(manifest.tasks[0].id, 'complex-task-part-1');
    assert.equal(manifest.tasks[1].id, 'complex-task-part-2');
    assert.equal(manifest.tasks[2].id, 'complex-task-part-3');
  });

  it('injects warning for high-complexity task WITHOUT substeps', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'big-no-substeps',
          instructions: 'x'.repeat(2500),
          estimatedFiles: 25,
          scope: 'root',
        }),
      ],
    });

    const { splits, warnings } = analyzeAndSplit(manifest, DEFAULT_CONFIG);

    assert.equal(splits.length, 0, 'Should NOT split without substeps');
    assert.equal(warnings.length, 1, 'Should inject 1 warning');
    assert.equal(manifest.tasks.length, 1, 'Task count unchanged');
    assert.equal(manifest.tasks[0]._complexityWarning, true);
    assert.equal(typeof manifest.tasks[0]._complexityScore, 'number');
  });

  it('rewires dependencies after splitting', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'complex',
          dependsOn: [],
          instructions: 'x'.repeat(2500),
          estimatedFiles: 25,
          scope: 'root',
          substeps: [
            { title: 'A', instructions: 'Step A' },
            { title: 'B', instructions: 'Step B' },
          ],
        }),
        makeTask({
          id: 'downstream',
          dependsOn: ['complex'],
          instructions: 'Depends on complex.',
        }),
      ],
    });

    analyzeAndSplit(manifest, DEFAULT_CONFIG);

    // 'downstream' should now depend on 'complex-part-2' (the last sub-task)
    const downstream = manifest.tasks.find((t) => t.id === 'downstream');
    assert.ok(downstream, 'downstream task should still exist');
    assert.ok(
      downstream.dependsOn.includes('complex-part-2'),
      `Expected dependsOn to include 'complex-part-2', got: ${JSON.stringify(downstream.dependsOn)}`,
    );
  });

  it('respects enableAutoSplit: false', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'complex',
          instructions: 'x'.repeat(2500),
          estimatedFiles: 25,
          scope: 'root',
          substeps: [
            { title: 'A', instructions: 'A' },
            { title: 'B', instructions: 'B' },
          ],
        }),
      ],
    });

    const config = { ...DEFAULT_CONFIG, enableAutoSplit: false };
    const { splits, warnings } = analyzeAndSplit(manifest, config);

    assert.equal(splits.length, 0, 'Should NOT split when disabled');
    assert.equal(warnings.length, 1, 'Should still warn');
    assert.equal(manifest.tasks.length, 1, 'Task count unchanged');
  });

  it('respects maxSubstepsPerTask limit', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'huge',
          instructions: 'x'.repeat(2500),
          estimatedFiles: 25,
          scope: 'root',
          substeps: [
            { title: 'A', instructions: 'A' },
            { title: 'B', instructions: 'B' },
            { title: 'C', instructions: 'C' },
            { title: 'D', instructions: 'D' },
            { title: 'E', instructions: 'E' },
            { title: 'F', instructions: 'F' },
            { title: 'G', instructions: 'G' },
          ],
        }),
      ],
    });

    const config = { ...DEFAULT_CONFIG, maxSubstepsPerTask: 3 };
    analyzeAndSplit(manifest, config);

    assert.equal(manifest.tasks.length, 3, 'Should cap at maxSubstepsPerTask');
  });

  it('does not split bookend tasks even if they score high', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'integ',
          isIntegration: true,
          instructions: 'x'.repeat(3000),
          estimatedFiles: 30,
          persona: 'engineer',
          skills: ['architecture/monorepo-path-strategist', 'devops/git-flow-specialist'],
        }),
      ],
    });

    const { splits, warnings } = analyzeAndSplit(manifest, DEFAULT_CONFIG);

    assert.equal(splits.length, 0);
    assert.equal(warnings.length, 0);
    assert.equal(manifest.tasks.length, 1);
  });

  it('does not split when substeps has only 1 entry', () => {
    const manifest = makeManifest({
      tasks: [
        makeTask({
          id: 'barely',
          instructions: 'x'.repeat(2500),
          estimatedFiles: 25,
          scope: 'root',
          substeps: [{ title: 'Only Step', instructions: 'Everything.' }],
        }),
      ],
    });

    const { splits, warnings } = analyzeAndSplit(manifest, DEFAULT_CONFIG);

    assert.equal(splits.length, 0, 'Should not split with 1 substep');
    assert.equal(warnings.length, 1, 'Should warn instead');
  });
});
