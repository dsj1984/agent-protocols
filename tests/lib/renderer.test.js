import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, renderTaskBlock } from '../../.agents/scripts/lib/Renderer.js';
import {
  buildGraph,
  assignLayers,
  computeChatDependencies,
} from '../../.agents/scripts/lib/Graph.js';
import { groupIntoChatSessions } from '../../.agents/scripts/generate-playbook.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides = {}) {
  return {
    id: 'task-a',
    title: 'Task A',
    dependsOn: [],
    persona: 'engineer',
    skills: [],
    model: 'Claude Sonnet 4.6',
    mode: 'Planning',
    instructions: 'Do the thing.',
    ...overrides,
  };
}

function makeManifest(overrides = {}) {
  return {
    sprintNumber: 7,
    sprintName: 'Renderer Test Sprint',
    summary: 'Testing the renderer sub-functions.',
    tasks: [makeTask()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderHeader
// ---------------------------------------------------------------------------

describe('renderHeader', () => {
  it('includes the sprint number padded to 3 digits', () => {
    const manifest = makeManifest({ sprintNumber: 7 });
    const md = renderHeader(manifest, { sprintNumberPadding: 3 });
    assert.match(md, /# Sprint 007 Playbook:/);
  });

  it('includes the sprint name in the title', () => {
    const manifest = makeManifest({ sprintName: 'My Cool Sprint' });
    const md = renderHeader(manifest);
    assert.match(md, /My Cool Sprint/);
  });

  it('includes the objective / summary', () => {
    const manifest = makeManifest({ summary: 'Fix all the bugs.' });
    const md = renderHeader(manifest);
    assert.match(md, /Fix all the bugs\./);
  });

  it('includes protocol version when provided', () => {
    const manifest = makeManifest();
    const md = renderHeader(manifest, { protocolVersion: '4.6.1' });
    assert.match(md, /Protocol Version.*4\.6\.1/);
  });

  it('omits protocol version line when not provided', () => {
    const manifest = makeManifest();
    const md = renderHeader(manifest, {});
    assert.ok(!md.includes('Protocol Version'), 'Should not include version line');
  });

  it('includes mode line when manifest.mode is set', () => {
    const manifest = makeManifest({ mode: 'Fast' });
    const md = renderHeader(manifest, {});
    assert.match(md, /Mode.*Fast/);
  });

  it('uses custom docsRoot path in Playbook Path', () => {
    const manifest = makeManifest({ sprintNumber: 5 });
    const md = renderHeader(manifest, { sprintDocsRoot: 'my-docs/sprints', sprintNumberPadding: 3 });
    assert.match(md, /my-docs\/sprints\/sprint-005/);
  });
});

// ---------------------------------------------------------------------------
// renderTaskBlock
// ---------------------------------------------------------------------------

describe('renderTaskBlock', () => {
  function buildSimpleSession(taskOverrides = {}) {
    const task = makeTask(taskOverrides);
    const manifest = makeManifest({ tasks: [task] });
    const { adjacency } = buildGraph(manifest.tasks);
    const layers = assignLayers(adjacency);
    const sessions = groupIntoChatSessions(manifest.tasks, layers, adjacency);
    const session = sessions[0];
    const taskIdToNumber = new Map();
    for (const s of sessions) {
      for (let i = 0; i < s.tasks.length; i++) {
        taskIdToNumber.set(s.tasks[i].id, `007.${s.chatNumber}.${i + 1}`);
      }
    }
    return { task: session.tasks[0], session, taskIdToNumber };
  }

  it('includes the full task id in the checklist header', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession();
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /\[ \] \*\*007\.1\.1\*\*/);
  });

  it('includes task metadata: Mode, Model, Dependencies', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession({ mode: 'Fast', model: 'Gemini Flash' });
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /\*\*Mode\*\*: Fast/);
    assert.match(md, /\*\*Model\*\*: Gemini Flash/);
    assert.match(md, /\*\*Dependencies\*\*: None/);
  });

  it('includes AGENT EXECUTION PROTOCOL block', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession();
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /AGENT EXECUTION PROTOCOL/);
  });

  it('includes Mark Executing instruction', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession();
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /Mark Executing/);
  });

  it('includes verify-prereqs script call', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession();
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /verify-prereqs\.js/);
  });

  it('includes HITL warning for integration tasks', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession({ isIntegration: true, instructions: '' });
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /HITL/);
  });

  it('includes auto-split indicator when _splitFrom is set', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession({
      _splitFrom: 'original-task',
      _splitIndex: 1,
      _splitTotal: 3,
    });
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /Auto-split/);
    assert.match(md, /original-task/);
  });

  it('includes Manual Fix block only for code review tasks', () => {
    const { task: reviewTask, session: reviewSession, taskIdToNumber: reviewMap } =
      buildSimpleSession({ isCodeReview: true, instructions: '' });
    const reviewMd = renderTaskBlock(reviewTask, reviewSession, reviewMap, [], 0, { _sprintNum: '007' });
    assert.match(reviewMd, /Manual Fix Finalization/);

    const { task: devTask, session: devSession, taskIdToNumber: devMap } = buildSimpleSession();
    const devMd = renderTaskBlock(devTask, devSession, devMap, [], 0, { _sprintNum: '007' });
    assert.ok(!devMd.includes('Manual Fix Finalization'), 'Should not have manual fix block for dev tasks');
  });

  it('includes complexity warning when _complexityWarning is set', () => {
    const { task, session, taskIdToNumber } = buildSimpleSession({
      _complexityWarning: true,
      _complexityScore: 10,
    });
    const md = renderTaskBlock(task, session, taskIdToNumber, [], 0, { _sprintNum: '007' });
    assert.match(md, /COMPLEXITY WARNING/);
    assert.match(md, /Score: 10/);
  });
});
