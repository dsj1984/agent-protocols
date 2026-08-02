import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '../../../.agents/scripts/lib/Logger.js';
import { SPEC_SOFT_WORD_BUDGET } from '../../../.agents/scripts/lib/orchestration/spec-budget.js';
import {
  _internal,
  validateAndNormalizeTickets,
} from '../../../.agents/scripts/lib/orchestration/ticket-validator.js';
import { serialize } from '../../../.agents/scripts/lib/story-body/story-body.js';

/**
 * Stories-only backlog invariant (Story #4041).
 *
 * `assertAllTicketsAreStories` is a deterministic, HARD invariant under the
 * 2-tier hierarchy (Epic → Story): every ticket the decomposer emits must
 * be `type: "story"` and at least one Story must be present. Any other type
 * (the retired `feature` / `task` tiers, or planner hallucinations) rejects
 * the decomposition with a throw that names the offending tickets.
 *
 * Every Story carries its top-level inline contract (`acceptance[]` +
 * `verify[]`) plus a structured body.
 */

function story(slug, title = `Story ${slug}`) {
  return {
    slug,
    type: 'story',
    title,
    acceptance: [`${title} is implemented`],
    verify: ['npm test (unit)'],
    body: {
      goal: `Goal for ${slug}.`,
      changes: [`src/${slug}.js: edit`],
      acceptance: [`${title} is implemented`],
      verify: ['npm test (unit)'],
    },
  };
}

describe('ticket-validator: Stories-only backlog (Story #4041)', () => {
  it('PASSES a backlog containing only Stories', () => {
    const backlog = [story('s1'), story('s2')];
    assert.doesNotThrow(() => validateAndNormalizeTickets(backlog));
  });

  it('REJECTS a backlog carrying a retired Feature ticket', () => {
    const backlog = [
      { slug: 'f1', type: 'feature', title: 'Retired Feature' },
      story('s1'),
      story('s2'),
    ];
    assert.throws(
      () => validateAndNormalizeTickets(backlog),
      /are not Stories/,
    );
  });

  it('REJECTS a backlog carrying a retired Task ticket', () => {
    const backlog = [
      story('s1'),
      { slug: 't1', type: 'task', title: 'Retired Task' },
    ];
    assert.throws(
      () => validateAndNormalizeTickets(backlog),
      /are not Stories/,
    );
  });

  it('names every offending non-Story ticket with slug and type', () => {
    const backlog = [
      { slug: 'f-a', type: 'feature', title: 'Feature A' },
      { slug: 't-b', type: 'task', title: 'Task B' },
      story('s1'),
    ];
    let caught;
    try {
      validateAndNormalizeTickets(backlog);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected a throw');
    assert.match(caught.message, /2 ticket\(s\) are not Stories/);
    assert.match(caught.message, /"Feature A" \(f-a, type: feature\)/);
    assert.match(caught.message, /"Task B" \(t-b, type: task\)/);
    assert.match(caught.message, /admits type "story" only/);
  });

  it('REJECTS an empty backlog (at least one Story required)', () => {
    assert.throws(() => validateAndNormalizeTickets([]), /at least one Story/);
  });
});

describe('assertAllTicketsAreStories unit (Story #4041)', () => {
  const { assertAllTicketsAreStories } = _internal;

  it('throws when a non-Story ticket is present', () => {
    const tickets = [{ slug: 'f1', type: 'feature', title: 'F' }, story('s1')];
    assert.throws(
      () =>
        assertAllTicketsAreStories({
          tickets,
          stories: tickets.filter((t) => t.type === 'story'),
        }),
      /are not Stories/,
    );
  });

  it('throws when the backlog has zero Stories', () => {
    assert.throws(
      () => assertAllTicketsAreStories({ tickets: [], stories: [] }),
      /at least one Story/,
    );
  });

  it('does not throw on a Stories-only backlog', () => {
    const tickets = [story('s1'), story('s2')];
    assert.doesNotThrow(() =>
      assertAllTicketsAreStories({ tickets, stories: tickets }),
    );
  });
});

/**
 * Soft `## Spec` word-budget pass (Story #4723, AC-3): an over-budget Spec
 * produces an advisory `'soft'` finding and NEVER an error — the persist
 * proceeds. An under-budget Spec produces no finding at all.
 */
describe('ticket-validator: soft ## Spec word budget (Story #4723)', () => {
  const overBudgetSpec = Array.from(
    { length: SPEC_SOFT_WORD_BUDGET + 50 },
    (_v, i) => `word${i}`,
  ).join(' ');

  function specFindings(validated) {
    return validated.findings.filter((f) => f.kind === 'spec-word-budget');
  }

  it('emits one soft finding for an over-budget object-body Spec, never an error', () => {
    const s = story('over-budget');
    s.body.spec = overBudgetSpec;
    const validated = validateAndNormalizeTickets([s, story('sibling')]);
    const findings = specFindings(validated);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'soft');
    assert.equal(findings[0].ticketSlug, 'over-budget');
    assert.equal(findings[0].budget, SPEC_SOFT_WORD_BUDGET);
    assert.ok(findings[0].words > SPEC_SOFT_WORD_BUDGET);
    assert.match(findings[0].message, /advisory only/);
    // Advisory only — the soft finding never reaches the errors channel.
    assert.deepEqual(validated.errors, []);
  });

  it('fires on the canonical serialized string-body shape too', () => {
    const s = story('string-body');
    s.body = serialize({
      goal: 'Goal for string-body.',
      spec: overBudgetSpec,
      changes: [
        { path: 'src/string-body.js', assumption: 'refactors-existing' },
      ],
      acceptance: ['String-body Story is implemented'],
      verify: ['npm test (unit)'],
    });
    const validated = validateAndNormalizeTickets([s]);
    const findings = specFindings(validated);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'soft');
    assert.deepEqual(validated.errors, []);
  });

  it('emits no finding for an under-budget Spec or an absent one', () => {
    const withSpec = story('under-budget');
    withSpec.body.spec = 'A short contract-level spec.';
    const withoutSpec = story('no-spec');
    const validated = validateAndNormalizeTickets([withSpec, withoutSpec]);
    assert.deepEqual(specFindings(validated), []);
  });

  /**
   * The threshold is retuned to 350 (Story #4907) and pinned by value here.
   * The tests above reference `SPEC_SOFT_WORD_BUDGET` symbolically, so they
   * follow the constant wherever it moves and cannot catch a regression in
   * the number itself. A 300-word Spec is ordinary authoring variance under
   * the ~250 target and must stay silent; 400 words is the outlier the
   * warning exists for.
   */
  function specOf(words) {
    return Array.from({ length: words }, (_v, i) => `word${i}`).join(' ');
  }

  it('is silent at 300 words and fires at 400 — the threshold is 350', () => {
    const quiet = story('three-hundred');
    quiet.body.spec = specOf(300);
    assert.deepEqual(specFindings(validateAndNormalizeTickets([quiet])), []);

    const loud = story('four-hundred');
    loud.body.spec = specOf(400);
    const findings = specFindings(validateAndNormalizeTickets([loud]));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].budget, 350);
  });

  /**
   * `spec-word-budget` was the only finding kind logged twice per run — once
   * by this pass and again by plan-persist's soft-finding surface. The
   * validator now computes without reporting, matching how it already treats
   * the sizing and conflict kinds (Story #4907).
   */
  it('computes the finding without warning — reporting belongs to persist', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});
    const s = story('over-budget-quiet');
    s.body.spec = overBudgetSpec;

    const validated = validateAndNormalizeTickets([s]);

    assert.equal(specFindings(validated).length, 1);
    const spoke = warn.mock.calls
      .map((c) => String(c.arguments[0]))
      .filter((l) => /spec-word-budget|## Spec is ~/.test(l));
    assert.deepEqual(
      spoke,
      [],
      'the validator must not warn; persist surfaces it exactly once',
    );
  });
});
