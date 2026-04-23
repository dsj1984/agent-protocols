/**
 * E2E: dispatch_wave → transition_ticket_state(task, done) → cascade_completion
 *
 * Satisfies AC-14 (Epic #511): seeds a fake ITicketingProvider with
 * Epic → Feature → Story → Task, walks the chain through the real MCP tool
 * handlers, and asserts the cascade closes Story and Feature while the Epic
 * remains open.
 *
 * The test exercises the tool registry — `getToolRegistry(sdk, getProvider)` —
 * so a regression in the wiring between the MCP tool layer and the
 * orchestration SDK is caught end-to-end, not just at the SDK boundary that
 * `tests/e2e-story-lifecycle.test.js` already covers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getToolRegistry } from '../../.agents/scripts/lib/mcp/tool-registry.js';
import * as sdk from '../../.agents/scripts/lib/orchestration/index.js';
import { MockProvider } from '../fixtures/mock-provider.js';

const EPIC_ID = 10_001;
const FEATURE_ID = 10_002;
const STORY_ID = 10_003;
const TASK_ID = 10_004;

class E2EMockProvider extends MockProvider {
  async getEpic(epicId) {
    return this.tickets[epicId];
  }
}

function seedHierarchy() {
  return new E2EMockProvider({
    tickets: {
      [EPIC_ID]: {
        id: EPIC_ID,
        number: EPIC_ID,
        title: 'Epic E',
        labels: ['type::epic', 'agent::executing'],
        body: `Epic body\n\n- [ ] #${FEATURE_ID}`,
        state: 'open',
      },
      [FEATURE_ID]: {
        id: FEATURE_ID,
        number: FEATURE_ID,
        title: 'Feature F',
        labels: ['type::feature', 'agent::executing'],
        body: `parent: #${EPIC_ID}\n\n- [ ] #${STORY_ID}`,
        state: 'open',
      },
      [STORY_ID]: {
        id: STORY_ID,
        number: STORY_ID,
        title: 'Story S',
        labels: ['type::story', 'agent::executing'],
        body: `parent: #${FEATURE_ID}\nEpic: #${EPIC_ID}\n\n- [ ] #${TASK_ID}`,
        state: 'open',
      },
      [TASK_ID]: {
        id: TASK_ID,
        number: TASK_ID,
        title: 'Task T',
        labels: ['type::task', 'agent::ready'],
        body: `parent: #${STORY_ID}\nEpic: #${EPIC_ID}`,
        state: 'open',
      },
    },
    subTickets: {
      [EPIC_ID]: [FEATURE_ID],
      [FEATURE_ID]: [STORY_ID],
      [STORY_ID]: [TASK_ID],
    },
  });
}

test('e2e: dispatch_wave → transition(task, done) cascades through Story and Feature; Epic stays open', async () => {
  const provider = seedHierarchy();

  const tools = await getToolRegistry(sdk, () => provider);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const dispatchWave = toolByName.get('dispatch_wave');
  const transitionTool = toolByName.get('transition_ticket_state');

  assert.ok(dispatchWave, 'dispatch_wave must be registered');
  assert.ok(transitionTool, 'transition_ticket_state must be registered');

  // 1) dispatch_wave(Epic) — dryRun avoids git/adapter side effects while
  // still proving the tool can resolve the Epic, walk the ticket graph, and
  // return without throwing. Dispatched output is not asserted; the cascade
  // assertions below are what AC-14 actually pins.
  const dispatchResult = await dispatchWave.handler({
    epicId: EPIC_ID,
    dryRun: true,
  });
  assert.ok(dispatchResult, 'dispatch_wave should return a manifest object');

  // 2) transition_ticket_state(Task, agent::done) — this is the call a Task
  // executor makes when it finishes, and is the true trigger for cascade.
  const transitionResult = await transitionTool.handler({
    ticketId: TASK_ID,
    newState: 'agent::done',
  });
  assert.deepEqual(transitionResult, {
    success: true,
    ticketId: TASK_ID,
    newState: 'agent::done',
  });

  // 3) Cascade assertions.
  const task = await provider.getTicket(TASK_ID);
  const story = await provider.getTicket(STORY_ID);
  const feature = await provider.getTicket(FEATURE_ID);
  const epic = await provider.getTicket(EPIC_ID);

  assert.ok(task.labels.includes('agent::done'), 'Task should be agent::done');
  assert.equal(task.state, 'closed', 'Task should be closed');

  assert.ok(
    story.labels.includes('agent::done'),
    'Story should cascade-close when its only Task is done',
  );
  assert.equal(story.state, 'closed', 'Story state should be closed');

  assert.ok(
    feature.labels.includes('agent::done'),
    'Feature should cascade-close when its only Story is done (AC-05)',
  );
  assert.equal(feature.state, 'closed', 'Feature state should be closed');

  assert.ok(
    !epic.labels.includes('agent::done'),
    'Epic must NOT cascade-close — reserved for operator-driven /sprint-close',
  );
  assert.notEqual(
    epic.state,
    'closed',
    'Epic state must remain open after Feature-level cascade',
  );

  // Tasklist checkboxes should have been flipped as the cascade walked up.
  assert.ok(
    story.body.includes(`- [x] #${TASK_ID}`),
    "Story's tasklist checkbox for the Task should be checked",
  );
  assert.ok(
    feature.body.includes(`- [x] #${STORY_ID}`),
    "Feature's tasklist checkbox for the Story should be checked",
  );
  assert.ok(
    epic.body.includes(`- [x] #${FEATURE_ID}`),
    "Epic's tasklist checkbox for the Feature should be checked even though the Epic itself does not auto-close",
  );
});

test('e2e: cascade leaves siblings-open parent open (regression guard for premature close)', async () => {
  const provider = seedHierarchy();

  // Add a sibling Task under the same Story so the Story's children are not
  // all-done after transitioning TASK_ID. If the cascade mistakenly closed the
  // Story here, the assertion below would fail — pinning the all-done gate.
  const siblingTaskId = 10_005;
  provider.tickets[siblingTaskId] = {
    id: siblingTaskId,
    number: siblingTaskId,
    title: 'Task T2',
    labels: ['type::task', 'agent::ready'],
    body: `parent: #${STORY_ID}\nEpic: #${EPIC_ID}`,
    state: 'open',
  };
  provider.subTickets[STORY_ID] = [TASK_ID, siblingTaskId];
  provider.tickets[STORY_ID].body = `parent: #${FEATURE_ID}\nEpic: #${EPIC_ID}\n\n- [ ] #${TASK_ID}\n- [ ] #${siblingTaskId}`;

  const tools = await getToolRegistry(sdk, () => provider);
  const transitionTool = tools.find((t) => t.name === 'transition_ticket_state');

  await transitionTool.handler({
    ticketId: TASK_ID,
    newState: 'agent::done',
  });

  const story = await provider.getTicket(STORY_ID);
  assert.ok(
    !story.labels.includes('agent::done'),
    'Story must stay open while a sibling Task is still not done',
  );
  assert.equal(story.state, 'open', 'Story state must remain open');
});
