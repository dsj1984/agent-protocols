import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBookendTask } from '../../.agents/scripts/lib/task-utils.js';

describe('isBookendTask', () => {
  it('returns false for a plain development task', () => {
    assert.equal(isBookendTask({ id: 'feat-a', title: 'Feature A' }), false);
  });

  it('returns true for isIntegration', () => {
    assert.equal(isBookendTask({ id: 'integ', isIntegration: true }), true);
  });

  it('returns true for isQA', () => {
    assert.equal(isBookendTask({ id: 'qa', isQA: true }), true);
  });

  it('returns true for isCodeReview', () => {
    assert.equal(isBookendTask({ id: 'review', isCodeReview: true }), true);
  });

  it('returns true for isRetro', () => {
    assert.equal(isBookendTask({ id: 'retro', isRetro: true }), true);
  });

  it('returns true for isCloseSprint', () => {
    assert.equal(isBookendTask({ id: 'close', isCloseSprint: true }), true);
  });

  it('returns false when all flags are false or absent', () => {
    assert.equal(
      isBookendTask({
        id: 'reg',
        isIntegration: false,
        isQA: false,
        isCodeReview: false,
        isRetro: false,
        isCloseSprint: false,
      }),
      false,
    );
  });

  it('returns true when multiple bookend flags are set (data integrity guard)', () => {
    // This should not normally occur in production manifests, but the predicate
    // must still return true if any flag is set.
    assert.equal(isBookendTask({ id: 'multi', isIntegration: true, isQA: true }), true);
  });

  it('coerces truthy non-boolean to true', () => {
    assert.equal(isBookendTask({ id: 'x', isIntegration: 1 }), true);
  });

  it('coerces falsy string to false', () => {
    assert.equal(isBookendTask({ id: 'x', isIntegration: '' }), false);
  });
});
