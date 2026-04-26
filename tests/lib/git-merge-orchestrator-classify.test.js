import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Pin the conflict-severity classifier extracted from `mergeFeatureBranch`
 * (Story #816). The orchestrator delegates the major/minor decision so the
 * thresholds — and their fallbacks — can be tested without driving a real
 * merge. Defaults (files=3, lines=20) come from the `mergeThresholds`
 * agent-settings block.
 */

import { classifyConflictSeverity } from '../../.agents/scripts/lib/git-merge-orchestrator.js';

describe('classifyConflictSeverity', () => {
  it('returns "minor" for a clean, sub-threshold conflict', () => {
    assert.equal(classifyConflictSeverity({ files: 1, lines: 5 }), 'minor');
  });

  it('returns "major" when files meets the default threshold', () => {
    assert.equal(classifyConflictSeverity({ files: 3, lines: 0 }), 'major');
  });

  it('returns "major" when lines meets the default threshold', () => {
    assert.equal(classifyConflictSeverity({ files: 1, lines: 20 }), 'major');
  });

  it('honours custom thresholds when supplied', () => {
    assert.equal(
      classifyConflictSeverity({ files: 2, lines: 10 }, { files: 2 }),
      'major',
    );
    assert.equal(
      classifyConflictSeverity({ files: 1, lines: 9 }, { lines: 10 }),
      'minor',
    );
  });

  it('falls back to defaults when custom thresholds are partially supplied', () => {
    // files cap is 3 by default; lines cap is overridden to 100
    assert.equal(
      classifyConflictSeverity({ files: 3, lines: 50 }, { lines: 100 }),
      'major',
    );
    assert.equal(
      classifyConflictSeverity({ files: 2, lines: 99 }, { lines: 100 }),
      'minor',
    );
  });
});
