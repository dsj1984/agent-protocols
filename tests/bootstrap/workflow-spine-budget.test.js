/**
 * tests/bootstrap/workflow-spine-budget.test.js — lean-spine workflow budgets
 * (Story #4708, AC-4; headroom floor added by Story #4876).
 *
 * The big workflow files ride resident for a whole session once invoked, so
 * each is split into a spine (happy path + gate list) with edge-case /
 * recovery / reference content in an on-demand appendix helper. This test is
 * the ratchet: each governed file stays under 8KB *with room to spare*, and
 * each spine keeps pointing at its appendix so the moved content stays
 * reachable.
 *
 * A ceiling alone is not enough. A file that clears 8192 bytes by four bytes
 * is, in practice, unwritable: the next contract fix has to be paid for with
 * an unrelated trim in the same commit, which is how the delivery prose froze
 * in the first place. So the ratchet enforces a *minimum headroom* — governed
 * files must leave at least MIN_HEADROOM_BYTES of editing room under the
 * ceiling — and the same floor covers the role-scoped agent definitions,
 * which ride the identical per-file 8KB ceiling via the context-budget gate.
 */

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** AC-4 (#4708): each governed file must fit under 8KB. */
const SPINE_BUDGET_BYTES = 8 * 1024;

/**
 * AC-1 (#4876): and must leave at least this much room under that ceiling, so
 * the next contract edit does not have to buy its bytes from an unrelated
 * trim. Passing the ceiling by a handful of bytes re-creates the freeze.
 */
const MIN_HEADROOM_BYTES = 256;

/** Spine → the on-demand appendix helper its detail moved into. */
const SPINES = [
  {
    spine: '.agents/workflows/plan.md',
    appendix: '.agents/workflows/helpers/plan-reference.md',
    appendixRef: 'helpers/plan-reference.md',
  },
  {
    spine: '.agents/workflows/deliver.md',
    appendix: '.agents/workflows/helpers/deliver-reference.md',
    appendixRef: 'helpers/deliver-reference.md',
  },
  {
    spine: '.agents/workflows/helpers/deliver-story.md',
    appendix: '.agents/workflows/helpers/deliver-story-reference.md',
    appendixRef: 'deliver-story-reference.md',
  },
];

/**
 * Role-scoped agent definitions ride the same per-file 8KB ceiling (the
 * `agentBoot` tier of `baselines/context-budget.json`), so they answer to the
 * same headroom floor. They have no paired appendix — their on-demand detail
 * is the workflow prose their caller hands them.
 */
const AGENT_DEFINITIONS = [
  '.agents/agents/acceptance-critic.md',
  '.agents/agents/auditor.md',
  '.agents/agents/plan-critic.md',
  '.agents/agents/story-worker.md',
];

/**
 * The ratchet itself, as a pure function of a byte count, so the rule can be
 * exercised against a synthetic size rather than only against the tree.
 * Throws an AssertionError when `bytes` breaches the ceiling *or* eats into
 * the headroom floor.
 *
 * @param {{ label: string, bytes: number, relocateTo?: string }} input
 */
function assertSpineBudget({ label, bytes, relocateTo }) {
  const target = relocateTo
    ? `move edge-case/recovery/reference content into ${relocateTo} instead of growing the spine`
    : 'move detail into the on-demand tier instead of growing the file';

  assert.ok(
    bytes <= SPINE_BUDGET_BYTES,
    `${label} is ${bytes} bytes, over the ${SPINE_BUDGET_BYTES}-byte budget — ${target}`,
  );

  const headroom = SPINE_BUDGET_BYTES - bytes;
  assert.ok(
    headroom >= MIN_HEADROOM_BYTES,
    `${label} is ${bytes} bytes, leaving only ${headroom} bytes of headroom under the ` +
      `${SPINE_BUDGET_BYTES}-byte ceiling — the floor is ${MIN_HEADROOM_BYTES}. A file this ` +
      `close to the ceiling is effectively unwritable: ${target}`,
  );
}

describe('workflow spine budget (Story #4708, AC-4)', () => {
  for (const { spine, appendix, appendixRef } of SPINES) {
    it(`${spine} is ≤ ${SPINE_BUDGET_BYTES} bytes with ≥ ${MIN_HEADROOM_BYTES} bytes of headroom`, () => {
      const bytes = statSync(path.join(REPO_ROOT, spine)).size;
      assertSpineBudget({ label: spine, bytes, relocateTo: appendix });
    });

    it(`${spine} points at its on-demand appendix`, () => {
      const spineText = readFileSync(path.join(REPO_ROOT, spine), 'utf8');
      assert.ok(
        spineText.includes(appendixRef),
        `${spine} no longer references ${appendixRef} — the moved detail must stay reachable on demand`,
      );
      assert.ok(
        statSync(path.join(REPO_ROOT, appendix)).size > 0,
        `${appendix} is missing or empty`,
      );
    });
  }
});

describe('agent-definition budget (Story #4876, AC-2)', () => {
  for (const definition of AGENT_DEFINITIONS) {
    it(`${definition} leaves ≥ ${MIN_HEADROOM_BYTES} bytes of headroom`, () => {
      const bytes = statSync(path.join(REPO_ROOT, definition)).size;
      assertSpineBudget({ label: definition, bytes });
    });
  }
});

describe('the headroom floor is enforced, not just the ceiling (Story #4876, AC-1)', () => {
  it('accepts a file that clears the ceiling with room to spare', () => {
    assert.doesNotThrow(() =>
      assertSpineBudget({
        label: 'synthetic.md',
        bytes: SPINE_BUDGET_BYTES - MIN_HEADROOM_BYTES,
      }),
    );
  });

  it('rejects a file that passes the ceiling but leaves less than the floor', () => {
    assert.throws(
      () =>
        assertSpineBudget({
          label: 'synthetic.md',
          bytes: SPINE_BUDGET_BYTES - MIN_HEADROOM_BYTES + 1,
        }),
      /leaving only \d+ bytes of headroom/,
      'a file under the 8KB ceiling but inside the headroom floor must still fail the ratchet',
    );
  });

  it('still rejects a file over the ceiling', () => {
    assert.throws(
      () =>
        assertSpineBudget({
          label: 'synthetic.md',
          bytes: SPINE_BUDGET_BYTES + 1,
        }),
      /over the \d+-byte budget/,
    );
  });
});
