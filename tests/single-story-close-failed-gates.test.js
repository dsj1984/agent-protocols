/**
 * tests/single-story-close-failed-gates.test.js
 *
 * The terminal schema's `gates` contract: "A gate the run skipped … reports
 * `skipped` rather than being omitted, so a missing gate is never mistaken
 * for a passing one."
 *
 * The failed-terminal builder used to name ONLY the gate that died and omit
 * the other two entirely — exactly the ambiguity the contract forbids. A
 * reader of a base-sync failure could not tell whether validation had passed
 * or had never run.
 *
 * Story #5172 extends the reported set two ways. The phase order swapped —
 * base-sync now runs BEFORE close-validation — so a gate failure reports
 * base-sync as already `passed`. And the split baselines entries are reported
 * under their own names, so a reader can tell the cheap coverage-independent
 * half from the coverage-consuming half.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gatesForFailedPhase } from '../.agents/scripts/single-story-close.js';

const BASELINES_INDEPENDENT = 'check-baselines-independent';
const BASELINES_COVERAGE = 'check-baselines-coverage';
const ALL_GATES = [
  'validation',
  'baseSync',
  'codeReview',
  BASELINES_INDEPENDENT,
  BASELINES_COVERAGE,
];
const OUTCOMES = new Set(['passed', 'failed', 'skipped']);

describe('gatesForFailedPhase', () => {
  it('always reports every gate, whatever phase died', () => {
    for (const phase of [
      'init',
      'wrong-tree-guard',
      'base-sync',
      'close-validation',
      'push',
      'pull-request',
      'code-review',
      'auto-merge',
      'confirm-merge',
      'post-land',
    ]) {
      const gates = gatesForFailedPhase(phase, {});
      assert.deepEqual(
        Object.keys(gates).sort(),
        [...ALL_GATES].sort(),
        `phase ${phase} must report every gate`,
      );
      for (const [gate, outcome] of Object.entries(gates)) {
        assert.ok(
          OUTCOMES.has(outcome),
          `${gate}=${outcome} is not a schema outcome`,
        );
      }
    }
  });

  it('names the dead gate failed and leaves later gates skipped, not passed', () => {
    // Story #5172 — base-sync precedes close-validation, so reaching the
    // gates means the sync already cleared.
    assert.deepEqual(gatesForFailedPhase('close-validation', {}), {
      validation: 'failed',
      baseSync: 'passed',
      codeReview: 'skipped',
      [BASELINES_INDEPENDENT]: 'skipped',
      [BASELINES_COVERAGE]: 'skipped',
    });
  });

  it('reports a base-sync failure with validation never run (Story #5172 order)', () => {
    assert.deepEqual(gatesForFailedPhase('base-sync', {}), {
      validation: 'skipped',
      baseSync: 'failed',
      codeReview: 'skipped',
      [BASELINES_INDEPENDENT]: 'skipped',
      [BASELINES_COVERAGE]: 'skipped',
    });
  });

  // AC-3 — the two baselines entries are separable in failure output.
  it('names the coverage-independent baselines entry as the one that failed', () => {
    assert.deepEqual(
      gatesForFailedPhase('close-validation', {
        failedGate: BASELINES_INDEPENDENT,
      }),
      {
        validation: 'failed',
        baseSync: 'passed',
        codeReview: 'skipped',
        [BASELINES_INDEPENDENT]: 'failed',
        [BASELINES_COVERAGE]: 'skipped',
      },
    );
  });

  it('names the coverage-consuming baselines entry as the one that failed, with its sibling passed', () => {
    assert.deepEqual(
      gatesForFailedPhase('close-validation', {
        failedGate: BASELINES_COVERAGE,
      }),
      {
        validation: 'failed',
        baseSync: 'passed',
        codeReview: 'skipped',
        // The independent entry is in the parallel partition that must go
        // green before any serial gate starts, so it demonstrably passed.
        [BASELINES_INDEPENDENT]: 'passed',
        [BASELINES_COVERAGE]: 'failed',
      },
    );
  });

  it('claims no baselines pass when some other validation gate died', () => {
    const gates = gatesForFailedPhase('close-validation', {
      failedGate: 'lint',
    });
    assert.equal(gates[BASELINES_INDEPENDENT], 'skipped');
    assert.equal(gates[BASELINES_COVERAGE], 'skipped');
  });

  it('reports gates the run had already cleared as passed', () => {
    // Reaching code-review means validation and base-sync completed — the
    // pipeline is strictly sequential.
    assert.deepEqual(gatesForFailedPhase('code-review', {}), {
      validation: 'passed',
      baseSync: 'passed',
      codeReview: 'failed',
      [BASELINES_INDEPENDENT]: 'passed',
      [BASELINES_COVERAGE]: 'passed',
    });
  });

  it('reports an operator-disabled gate as skipped, never passed', () => {
    assert.deepEqual(
      gatesForFailedPhase('code-review', {
        skipValidation: true,
        skipSync: true,
      }),
      {
        validation: 'skipped',
        baseSync: 'skipped',
        codeReview: 'failed',
        [BASELINES_INDEPENDENT]: 'skipped',
        [BASELINES_COVERAGE]: 'skipped',
      },
    );
  });

  it('reports every gate skipped when the run died before any of them', () => {
    assert.deepEqual(gatesForFailedPhase('init', {}), {
      validation: 'skipped',
      baseSync: 'skipped',
      codeReview: 'skipped',
      [BASELINES_INDEPENDENT]: 'skipped',
      [BASELINES_COVERAGE]: 'skipped',
    });
  });

  it('marks post-arm phases as having cleared every gate', () => {
    assert.deepEqual(gatesForFailedPhase('confirm-merge', {}), {
      validation: 'passed',
      baseSync: 'passed',
      codeReview: 'passed',
      [BASELINES_INDEPENDENT]: 'passed',
      [BASELINES_COVERAGE]: 'passed',
    });
  });

  it('degrades to all-skipped for an unrecognised phase rather than claiming passes', () => {
    assert.deepEqual(gatesForFailedPhase('not-a-phase', {}), {
      validation: 'skipped',
      baseSync: 'skipped',
      codeReview: 'skipped',
      [BASELINES_INDEPENDENT]: 'skipped',
      [BASELINES_COVERAGE]: 'skipped',
    });
  });
});
