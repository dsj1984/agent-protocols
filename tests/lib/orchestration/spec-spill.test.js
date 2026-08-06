/**
 * Unit tests for the v2 Story ## Spec budget gate (no spill-to-docs) and the
 * shared §2 FinOps token estimator this module owns (Story #5005 relocated it
 * here from the retired `context-envelope.js` SDK).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertSpecWithinBudget,
  DEFAULT_SPEC_BODY_TOKEN_BUDGET,
  estimateTokens,
} from '../../../.agents/scripts/lib/orchestration/spec-spill.js';

describe('estimateTokens', () => {
  it('uses Math.ceil(length / 4)', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
  });

  it('coerces null / undefined / non-string input to the empty string', () => {
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
    assert.equal(estimateTokens(1234), 1);
  });
});

describe('assertSpecWithinBudget — under budget', () => {
  it('keeps a small spec inline', () => {
    const res = assertSpecWithinBudget({
      storyId: 's1',
      spec: 'short spec',
    });
    assert.equal(res.content, 'short spec');
    assert.ok(res.estimatedTokens < DEFAULT_SPEC_BODY_TOKEN_BUDGET);
  });
});

describe('assertSpecWithinBudget — over budget', () => {
  const bigSpec = 'x'.repeat((DEFAULT_SPEC_BODY_TOKEN_BUDGET + 100) * 4);

  it('rejects an over-budget Spec instead of writing docs/', () => {
    assert.throws(
      () => assertSpecWithinBudget({ storyId: '#4512', spec: bigSpec }),
      /too large|never written to docs/,
    );
  });

  it('honors a custom budget', () => {
    assert.throws(
      () =>
        assertSpecWithinBudget(
          { storyId: 's1', spec: 'x'.repeat(41) },
          { tokenBudget: 10 },
        ),
      /budget 10/,
    );
  });
});
