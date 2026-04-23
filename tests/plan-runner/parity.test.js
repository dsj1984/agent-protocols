/**
 * Parity tests for the plan-router + remote-bootstrap `--phase` handshake.
 * We do not shell out to `claude` or clone a repo — the SKIP_LAUNCH path in
 * remote-bootstrap.js exists precisely so the launch step stays behind a
 * unit-testable seam. Here we import the pure helpers (`resolvePhase`,
 * `PHASE_TO_COMMAND`) and the plan-router descriptors directly.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGENT_LABELS } from '../../.agents/scripts/lib/label-constants.js';
import {
  nextPhaseForEpic,
  PLAN_PHASE_DESCRIPTORS,
  PLAN_PHASE_NAMES,
  phaseForLabel,
} from '../../.agents/scripts/lib/orchestration/plan-runner/plan-router.js';
import {
  PHASE_TO_COMMAND,
  parsePhaseFromArgv,
  resolvePhase,
} from '../../.agents/scripts/remote-bootstrap.js';

function commandForPhase(phase, epicId) {
  return `${PHASE_TO_COMMAND[phase]} ${epicId}`;
}

describe('plan-runner parity (features/remote-planning.feature)', () => {
  it('(a) agent::planning → --phase spec → /sprint-plan --phase spec', () => {
    const epicId = 349;
    const descriptor = phaseForLabel(AGENT_LABELS.PLANNING);
    assert.equal(descriptor.phase, PLAN_PHASE_NAMES.SPEC);

    const phase = resolvePhase({ argv: ['--phase', 'spec'], env: {} });
    assert.equal(phase, 'spec');
    assert.equal(
      commandForPhase(phase, epicId),
      `/sprint-plan --phase spec ${epicId}`,
    );
    assert.equal(
      PHASE_TO_COMMAND[phase],
      descriptor.command,
      'remote-bootstrap command matches plan-router descriptor',
    );
  });

  it('(b) review-spec is a parking state — the wrapper advances to decompose', () => {
    const next = nextPhaseForEpic(['type::epic', AGENT_LABELS.REVIEW_SPEC]);
    assert.equal(
      next.phase,
      PLAN_PHASE_NAMES.DECOMPOSE,
      'wrapper picks decompose after review',
    );
    // epic-orchestrator.yml should never fire on review-spec; phaseForLabel
    // returns null for any label that is not itself a trigger.
    assert.equal(phaseForLabel(AGENT_LABELS.REVIEW_SPEC), null);
  });

  it('(c) agent::decomposing → --phase decompose → /sprint-plan --phase decompose', () => {
    const epicId = 349;
    const descriptor = phaseForLabel(AGENT_LABELS.DECOMPOSING);
    assert.equal(descriptor.phase, PLAN_PHASE_NAMES.DECOMPOSE);

    const phase = resolvePhase({
      argv: ['--phase=decompose'],
      env: {},
    });
    assert.equal(phase, 'decompose');
    assert.equal(
      commandForPhase(phase, epicId),
      `/sprint-plan --phase decompose ${epicId}`,
    );
    assert.equal(PHASE_TO_COMMAND[phase], descriptor.command);
  });

  it('(d) absent --phase defaults to execute for v5.14.0 parity', () => {
    const phase = resolvePhase({ argv: [], env: {} });
    assert.equal(phase, 'execute');
    assert.equal(
      commandForPhase(phase, 349),
      '/sprint-execute 349',
      'execute default preserves the legacy dispatch path',
    );
    // Plan-router surfaces the dispatch descriptor for the matching label;
    // the execute default maps to the same command.
    const dispatchDescriptor =
      PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.DISPATCH];
    assert.equal(dispatchDescriptor.command, PHASE_TO_COMMAND[phase]);
  });

  it('(d.env) PHASE env var is honored when --phase is absent', () => {
    assert.equal(resolvePhase({ argv: [], env: { PHASE: 'spec' } }), 'spec');
    // CLI flag wins over env.
    assert.equal(
      resolvePhase({ argv: ['--phase', 'decompose'], env: { PHASE: 'spec' } }),
      'decompose',
    );
  });

  it('(e) unknown --phase rejects before any side effects', () => {
    assert.throws(
      () => resolvePhase({ argv: ['--phase', 'bogus'], env: {} }),
      /Unknown --phase "bogus".*spec\|decompose\|execute/,
    );
    assert.throws(() => parsePhaseFromArgv(['--phase']), /requires a value/);
    assert.throws(
      () => parsePhaseFromArgv(['--phase', '--other']),
      /requires a value/,
    );
  });

  it('phase-to-command map stays in lockstep with plan-router descriptors', () => {
    // Defensive: if a new phase lands in one place, the other must follow.
    assert.equal(
      PHASE_TO_COMMAND[PLAN_PHASE_NAMES.SPEC],
      PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.SPEC].command,
    );
    assert.equal(
      PHASE_TO_COMMAND[PLAN_PHASE_NAMES.DECOMPOSE],
      PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.DECOMPOSE].command,
    );
    assert.equal(
      PHASE_TO_COMMAND.execute,
      PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.DISPATCH].command,
    );
  });
});
