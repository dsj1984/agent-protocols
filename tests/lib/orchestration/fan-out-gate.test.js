import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '../../../.agents/scripts/lib/Logger.js';
import {
  enforceFanOutGate,
  surfaceSoftConflictFindings,
} from '../../../.agents/scripts/lib/orchestration/plan-persist/fan-out-gate.js';

/**
 * plan-persist's soft-finding surface (Story #4907).
 *
 * `surfaceSoftConflictFindings` is the one place an operator reads the
 * validator's soft findings, and it used to announce every one of them as a
 * "soft cross-Story conflict". Only the conflict kinds are one: the advisory
 * kinds (`spec-word-budget` and the sizing findings) are single-Story nudges,
 * and overstating them taught readers to discount the whole channel.
 */

function conflictFinding(overrides = {}) {
  return {
    kind: 'shared-editor',
    severity: 'soft',
    path: 'src/shared.js',
    storySlugs: ['story-a', 'story-b'],
    ...overrides,
  };
}

function specBudgetFinding(overrides = {}) {
  return {
    kind: 'spec-word-budget',
    severity: 'soft',
    ticketSlug: 'wordy-story',
    words: 401,
    budget: 350,
    message: 'Story "wordy-story" ## Spec is ~401 words (soft budget 350).',
    ...overrides,
  };
}

function warnLines(mock) {
  return mock.mock.calls.map((c) => String(c.arguments[0]));
}

describe('surfaceSoftConflictFindings: labels each soft finding by its kind (Story #4907)', () => {
  it('announces a genuine cross-Story conflict as a conflict', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    surfaceSoftConflictFindings([conflictFinding()]);

    const lines = warnLines(warn);
    assert.ok(
      lines.some((l) => /soft cross-Story conflict finding\(s\)/.test(l)),
      'expected the conflict header',
    );
    assert.ok(
      lines.some((l) => /soft conflict: Shared-editor conflict/.test(l)),
      'expected the conflict to render through renderHardConflictError',
    );
  });

  it('never calls an advisory spec-word-budget finding a cross-Story conflict', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    surfaceSoftConflictFindings([specBudgetFinding()]);

    const lines = warnLines(warn);
    assert.equal(
      lines.some((l) => /conflict/i.test(l)),
      false,
      'a single-Story Spec-length nudge is not a cross-Story conflict',
    );
    assert.ok(
      lines.some((l) => /advisory \(spec-word-budget\)/.test(l)),
      'expected the finding reported under its own kind',
    );
  });

  it('treats the sizing findings as advisories, not conflicts', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    surfaceSoftConflictFindings([
      {
        kind: 'merge-candidate',
        severity: 'soft',
        ticketSlug: 'thin-slice',
        message: 'Story "thin-slice" is a thin dependent slice.',
      },
    ]);

    const lines = warnLines(warn);
    assert.equal(
      lines.some((l) => /conflict/i.test(l)),
      false,
    );
    assert.ok(lines.some((l) => /advisory \(merge-candidate\)/.test(l)));
  });

  it('separates a mixed set so each finding lands under the right heading', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    surfaceSoftConflictFindings([conflictFinding(), specBudgetFinding()]);

    const lines = warnLines(warn);
    assert.ok(
      lines.some((l) => /1 soft cross-Story conflict finding\(s\)/.test(l)),
      'the conflict count must not absorb the advisory',
    );
    assert.ok(
      lines.some((l) => /1 advisory finding\(s\)/.test(l)),
      'the advisory count must not absorb the conflict',
    );
  });

  it('leaves fan-out warnings to the gate that owns them', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    surfaceSoftConflictFindings([
      { kind: 'fan-out-warning', severity: 'soft', storySlug: 's', path: 'p' },
    ]);

    assert.equal(warn.mock.calls.length, 0);
  });

  it('stays silent when there is nothing soft to report', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    surfaceSoftConflictFindings([{ kind: 'shared-editor', severity: 'hard' }]);
    surfaceSoftConflictFindings([]);
    surfaceSoftConflictFindings(undefined);

    assert.equal(warn.mock.calls.length, 0);
  });
});

describe('enforceFanOutGate: fails closed on large-fan-out deletions', () => {
  const fanOut = {
    kind: 'fan-out-warning',
    severity: 'soft',
    storySlug: 'delete-legacy',
    path: 'lib/legacy.js',
    callSiteCount: 12,
    threshold: 5,
  };

  it('throws naming the Story, the path and the importer count', () => {
    assert.throws(
      () => enforceFanOutGate([fanOut], false),
      /delete-legacy[\s\S]*lib\/legacy\.js[\s\S]*12 importer/,
    );
  });

  it('warns and proceeds under the operator override', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    assert.doesNotThrow(() => enforceFanOutGate([fanOut], true));

    assert.ok(
      warnLines(warn).some((l) => /--allow-large-fan-out/.test(l)),
      'the override must stay visible in the log',
    );
  });

  it('no-ops when no fan-out finding is present', () => {
    assert.doesNotThrow(() => enforceFanOutGate([specBudgetFinding()], false));
    assert.doesNotThrow(() => enforceFanOutGate([], false));
  });
});
