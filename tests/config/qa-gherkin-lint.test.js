/**
 * tests/config/qa-gherkin-lint.test.js — the `qa.gherkinLint` accessor.
 *
 * Presence of the block IS the opt-in signal for `check-gherkin-corpus.js`,
 * so the distinction the normalizer has to keep sharp is "absent" (null, gate
 * does not run) versus "present but sparse" (normalized, gate runs with
 * defaults). Collapsing the two would either switch the gate on for consumers
 * who never asked, or switch it off for one who did.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  __testing,
  getGherkinLint,
} from '../../.agents/scripts/lib/config/qa.js';

const { GHERKIN_LINT_DEFAULTS, resolveGherkinLint } = __testing;

describe('resolveGherkinLint', () => {
  it('returns null for anything that is not an object', () => {
    // null is what makes the gate report "not configured" and exit 0.
    for (const absent of [undefined, null, 'yes', 7, [], true]) {
      assert.equal(resolveGherkinLint(absent), null);
    }
  });

  it('applies both escape-hatch defaults to a scopes-only block', () => {
    const resolved = resolveGherkinLint({
      scopes: { web: { featureRoots: ['f'], stepRoots: ['s'] } },
    });
    assert.deepEqual(resolved.exemptionTags, [
      ...GHERKIN_LINT_DEFAULTS.exemptionTags,
    ]);
    assert.deepEqual(resolved.stepWaivers, []);
    assert.deepEqual(resolved.scopes, [
      { name: 'web', featureRoots: ['f'], stepRoots: ['s'] },
    ]);
  });

  it('honours an explicitly empty exemption list rather than re-defaulting it', () => {
    // `[]` is a decision — "@skip exempts nothing here" — not an omission.
    const resolved = resolveGherkinLint({ scopes: {}, exemptionTags: [] });
    assert.deepEqual(resolved.exemptionTags, []);
  });

  it('orders scopes by name so findings and reports are deterministic', () => {
    const resolved = resolveGherkinLint({
      scopes: {
        web: { featureRoots: ['w'], stepRoots: ['ws'] },
        admin: { featureRoots: ['a'], stepRoots: ['as'] },
      },
    });
    assert.deepEqual(
      resolved.scopes.map((s) => s.name),
      ['admin', 'web'],
    );
  });

  it('degrades a malformed scope to empty roots instead of throwing', () => {
    // An empty stepRoots list surfaces downstream as the fail-closed "zero
    // step definitions" error, which names the scope. Throwing here would
    // report a stack trace instead.
    const resolved = resolveGherkinLint({ scopes: { web: null } });
    assert.deepEqual(resolved.scopes, [
      { name: 'web', featureRoots: [], stepRoots: [] },
    ]);
  });

  it('drops non-string and empty entries from every string list', () => {
    const resolved = resolveGherkinLint({
      scopes: { web: { featureRoots: ['f', '', 3], stepRoots: [null, 's'] } },
      exemptionTags: ['@skip', 42],
      stepWaivers: ['a step', ''],
    });
    assert.deepEqual(resolved.scopes[0].featureRoots, ['f']);
    assert.deepEqual(resolved.scopes[0].stepRoots, ['s']);
    assert.deepEqual(resolved.exemptionTags, ['@skip']);
    assert.deepEqual(resolved.stepWaivers, ['a step']);
  });

  it('treats a non-object scopes value as no scopes at all', () => {
    assert.deepEqual(resolveGherkinLint({ scopes: ['web'] }).scopes, []);
  });
});

describe('getGherkinLint', () => {
  it('reads the block off a resolved config and tolerates its absence', () => {
    assert.equal(getGherkinLint(undefined), null);
    assert.equal(getGherkinLint({}), null);
    assert.equal(getGherkinLint({ qa: {} }), null);
    const resolved = getGherkinLint({
      qa: {
        gherkinLint: {
          scopes: { web: { featureRoots: ['f'], stepRoots: ['s'] } },
        },
      },
    });
    assert.equal(resolved.scopes.length, 1);
  });
});
