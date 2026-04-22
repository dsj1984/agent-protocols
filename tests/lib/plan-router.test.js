import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AGENT_LABELS } from '../../.agents/scripts/lib/label-constants.js';
import {
  PLAN_PHASE_DESCRIPTORS,
  PLAN_PHASE_NAMES,
  advancePhase,
  nextPhaseForEpic,
  phaseForLabel,
} from '../../.agents/scripts/lib/orchestration/plan-runner/plan-router.js';

describe('plan-router', () => {
  describe('phaseForLabel()', () => {
    it('maps agent::planning → spec descriptor', () => {
      const phase = phaseForLabel(AGENT_LABELS.PLANNING);
      assert.equal(phase.phase, PLAN_PHASE_NAMES.SPEC);
      assert.equal(phase.script, '.agents/scripts/sprint-plan-spec.js');
      assert.equal(phase.command, '/sprint-plan-spec');
    });

    it('maps agent::decomposing → decompose descriptor', () => {
      const phase = phaseForLabel(AGENT_LABELS.DECOMPOSING);
      assert.equal(phase.phase, PLAN_PHASE_NAMES.DECOMPOSE);
      assert.equal(phase.script, '.agents/scripts/sprint-plan-decompose.js');
    });

    it('maps agent::dispatching → dispatch descriptor', () => {
      const phase = phaseForLabel(AGENT_LABELS.DISPATCHING);
      assert.equal(phase.phase, PLAN_PHASE_NAMES.DISPATCH);
    });

    it('returns null for parking labels (review-spec, ready)', () => {
      assert.equal(phaseForLabel(AGENT_LABELS.REVIEW_SPEC), null);
      assert.equal(phaseForLabel(AGENT_LABELS.READY), null);
    });

    it('returns null for labels that are not plan triggers', () => {
      assert.equal(phaseForLabel('type::epic'), null);
      assert.equal(phaseForLabel('unrelated::label'), null);
      assert.equal(phaseForLabel(undefined), null);
    });
  });

  describe('nextPhaseForEpic()', () => {
    it('returns the spec descriptor for a fresh Epic', () => {
      const next = nextPhaseForEpic(['type::epic']);
      assert.equal(next.phase, PLAN_PHASE_NAMES.SPEC);
    });

    it('returns null when the Epic is already on agent::ready', () => {
      const next = nextPhaseForEpic(['type::epic', AGENT_LABELS.READY]);
      assert.equal(next, null);
    });

    it('routes agent::decomposing → decompose descriptor', () => {
      const next = nextPhaseForEpic(['type::epic', AGENT_LABELS.DECOMPOSING]);
      assert.equal(next.phase, PLAN_PHASE_NAMES.DECOMPOSE);
    });

    it('routes agent::review-spec → decompose descriptor', () => {
      const next = nextPhaseForEpic(['type::epic', AGENT_LABELS.REVIEW_SPEC]);
      assert.equal(next.phase, PLAN_PHASE_NAMES.DECOMPOSE);
    });

    it('routes agent::planning → spec descriptor', () => {
      const next = nextPhaseForEpic(['type::epic', AGENT_LABELS.PLANNING]);
      assert.equal(next.phase, PLAN_PHASE_NAMES.SPEC);
    });

    it('prefers decompose when both planning and review-spec are present', () => {
      const next = nextPhaseForEpic([
        'type::epic',
        AGENT_LABELS.PLANNING,
        AGENT_LABELS.REVIEW_SPEC,
      ]);
      assert.equal(next.phase, PLAN_PHASE_NAMES.DECOMPOSE);
    });
  });

  describe('advancePhase()', () => {
    it('advances spec → decompose', () => {
      const next = advancePhase(PLAN_PHASE_NAMES.SPEC);
      assert.equal(next.phase, PLAN_PHASE_NAMES.DECOMPOSE);
    });

    it('returns null after decompose (terminal)', () => {
      assert.equal(advancePhase(PLAN_PHASE_NAMES.DECOMPOSE), null);
    });

    it('returns null for unknown phases', () => {
      assert.equal(advancePhase('unknown'), null);
    });
  });

  describe('descriptor map', () => {
    it('has stable trigger label mappings', () => {
      assert.equal(
        PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.SPEC].triggerLabel,
        AGENT_LABELS.PLANNING,
      );
      assert.equal(
        PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.SPEC].parkingLabel,
        AGENT_LABELS.REVIEW_SPEC,
      );
      assert.equal(
        PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.DECOMPOSE].triggerLabel,
        AGENT_LABELS.DECOMPOSING,
      );
      assert.equal(
        PLAN_PHASE_DESCRIPTORS[PLAN_PHASE_NAMES.DECOMPOSE].parkingLabel,
        AGENT_LABELS.READY,
      );
    });
  });
});
