import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertCriteriaCoverage,
  resolveExpectedCriteria,
  runAcceptanceEval,
  runAcceptanceEvalCli,
  validateVerdict,
} from '../.agents/scripts/acceptance-eval.js';
import {
  computeVerdictFingerprint,
  resolveAcceptanceEvalRound,
} from '../.agents/scripts/lib/orchestration/acceptance-eval-decision.js';

/**
 * Story #4780 — `main` scored CRAP 69.1: the gate's whole error table
 * (missing flags, unreadable verdict, non-JSON verdict, storyId mismatch,
 * block) was unreached, on the CLI that decides whether a Story may close.
 *
 * The verdict reader, config resolver, decision core, and log sink are
 * injected through the optional final `deps` parameter
 * (`.agents/rules/test-seams.md` rules 1 and 5) — no file is written, no
 * signal is appended, and nothing is module-mocked.
 */

const verdictFixture = (overrides = {}) => ({
  storyId: 4780,
  schemaVersion: 1,
  round: 1,
  criteria: [
    {
      index: 0,
      criterion: 'AC-1 holds',
      verdict: 'met',
      evidence: 'npm test exits 0',
    },
  ],
  ...overrides,
});

function harness({ verdict = verdictFixture(), envelope, exitCode = 0 } = {}) {
  const infos = [];
  const seen = [];
  return {
    infos,
    seen,
    deps: {
      readFileSyncImpl: () => JSON.stringify(verdict),
      resolveConfigImpl: () => ({
        delivery: { acceptanceEval: { maxRounds: 2 } },
      }),
      validateVerdictImpl: (v) => v,
      runAcceptanceEvalImpl: async (args) => {
        seen.push(args);
        return {
          envelope: envelope ?? {
            storyId: args.storyId,
            decision: 'proceed',
            round: 1,
            cap: 2,
            unmetCriteria: [],
          },
          exitCode,
        };
      },
      logger: { info: (m) => infos.push(m) },
    },
  };
}

describe('validateVerdict', () => {
  it('returns the same reference for a well-formed verdict', () => {
    const verdict = verdictFixture();
    assert.equal(validateVerdict(verdict), verdict);
  });

  it('throws a detailed schema error for a malformed verdict', () => {
    assert.throws(
      () => validateVerdict({ storyId: 'not-a-number' }),
      /verdict failed schema validation/,
    );
  });

  it('reads the schema through the injected io seam', () => {
    assert.throws(
      () =>
        validateVerdict(verdictFixture(), {
          schemaPath: '/fake/schema.json',
          io: { readFileSync: () => JSON.stringify({ type: 'string' }) },
        }),
      /verdict failed schema validation/,
    );
  });

  it('does not memoise the compiled validator across differing schemas', () => {
    // A module-level cache would make this second call reuse the first
    // schema and pass — the regression guard for test-seams rule 3.
    validateVerdict(verdictFixture());
    assert.throws(
      () =>
        validateVerdict(verdictFixture(), {
          schemaPath: '/fake/schema.json',
          io: { readFileSync: () => JSON.stringify({ type: 'array' }) },
        }),
      /verdict failed schema validation/,
    );
  });
});

describe('runAcceptanceEvalCli', () => {
  it('refuses a missing or non-numeric --story', async () => {
    for (const argv of [
      ['--verdict', 'v.json'],
      ['--story', 'x', '--verdict', 'v.json'],
    ]) {
      await assert.rejects(
        () => runAcceptanceEvalCli(argv, harness().deps),
        /Usage: node acceptance-eval\.js --story <id> --verdict <path>/,
      );
    }
  });

  it('refuses a missing --verdict', async () => {
    await assert.rejects(
      () => runAcceptanceEvalCli(['--story', '4780'], harness().deps),
      /--verdict <path> is required/,
    );
  });

  it('names the unreadable verdict file', async () => {
    const h = harness();
    h.deps.readFileSyncImpl = () => {
      throw new Error('ENOENT: no such file');
    };
    await assert.rejects(
      () =>
        runAcceptanceEvalCli(
          ['--story', '4780', '--verdict', 'v.json'],
          h.deps,
        ),
      /cannot read verdict file at v\.json: ENOENT/,
    );
  });

  it('names a verdict file that is not valid JSON', async () => {
    const h = harness();
    h.deps.readFileSyncImpl = () => '{ not json';
    await assert.rejects(
      () =>
        runAcceptanceEvalCli(
          ['--story', '4780', '--verdict', 'v.json'],
          h.deps,
        ),
      /verdict file is not valid JSON/,
    );
  });

  it('refuses a verdict whose embedded storyId disagrees with --story', async () => {
    const h = harness({ verdict: verdictFixture({ storyId: 1234 }) });
    await assert.rejects(
      () =>
        runAcceptanceEvalCli(
          ['--story', '4780', '--verdict', 'v.json'],
          h.deps,
        ),
      /verdict storyId \(1234\) does not match --story 4780/,
    );
  });

  it('tolerates a verdict with no embedded storyId', async () => {
    const h = harness({ verdict: verdictFixture({ storyId: undefined }) });
    const envelope = await runAcceptanceEvalCli(
      ['--story', '4780', '--verdict', 'v.json'],
      h.deps,
    );
    assert.equal(envelope.decision, 'proceed');
  });

  it('prints the envelope as one JSON line and returns it on proceed', async () => {
    const h = harness();
    const envelope = await runAcceptanceEvalCli(
      ['--story', '4780', '--verdict', 'v.json'],
      h.deps,
    );
    assert.equal(h.infos.length, 1);
    assert.deepEqual(JSON.parse(h.infos[0]), envelope);
    assert.equal(h.seen[0].emitSignal, true);
  });

  it('suppresses the signal emit under --no-signal', async () => {
    const h = harness();
    await runAcceptanceEvalCli(
      ['--story', '4780', '--verdict', 'v.json', '--no-signal'],
      h.deps,
    );
    assert.equal(h.seen[0].emitSignal, false);
  });

  it('throws naming every unmet criterion when the decision is block', async () => {
    const h = harness({
      exitCode: 1,
      envelope: {
        storyId: 4780,
        decision: 'block',
        round: 2,
        cap: 2,
        unmetCriteria: [
          { index: 3, criterion: 'AC-3', verdict: 'not-met', evidence: null },
          { index: 5, criterion: 'AC-5', verdict: 'unclear', evidence: null },
        ],
      },
    });
    await assert.rejects(
      () =>
        runAcceptanceEvalCli(
          ['--story', '4780', '--verdict', 'v.json'],
          h.deps,
        ),
      (err) => {
        assert.match(
          err.message,
          /round cap \(2\) reached with criteria still unmet/,
        );
        assert.match(err.message, /#3 \(not-met\), #5 \(unclear\)/);
        assert.match(err.message, /Transition the Story to agent::blocked/);
        return true;
      },
    );
    // The envelope is still printed before the throw — the loop's record of
    // why it blocked must survive the non-zero exit.
    assert.equal(JSON.parse(h.infos[0]).decision, 'block');
  });
});

/**
 * Story #4951 — one round = N parallel cluster critics → ONE merged verdict →
 * ONE gate call.
 *
 * The round counter is Story-scoped, so a gate call per cluster spends a whole
 * round per cluster. `--expected-criteria` is the guard: a verdict that does
 * not cover every `acceptance[]` item is refused before the scoring path is
 * ever entered, which the `seen` spy makes observable — an empty `seen` means
 * the round ledger was never read or appended.
 */
describe('--expected-criteria — the merge contract (Story #4951)', () => {
  const clusterVerdict = (count) =>
    verdictFixture({
      criteria: Array.from({ length: count }, (_, index) => ({
        index,
        criterion: `AC-${index + 1} holds`,
        verdict: 'met',
        evidence: 'npm test exits 0',
      })),
    });

  it('resolves an absent flag to null so the assertion is opt-in', () => {
    assert.equal(resolveExpectedCriteria(null), null);
    assert.equal(resolveExpectedCriteria(undefined), null);
    assert.equal(resolveExpectedCriteria('4'), 4);
  });

  it('refuses a non-positive or non-numeric --expected-criteria', () => {
    for (const raw of ['0', '-2', 'four', '']) {
      assert.throws(
        () => resolveExpectedCriteria(raw),
        /--expected-criteria must be a positive integer/,
        `--expected-criteria ${raw} should be refused`,
      );
    }
  });

  it('passes a verdict covering exactly the expected criteria', () => {
    assert.doesNotThrow(() => assertCriteriaCoverage(clusterVerdict(4), 4));
  });

  it('is a no-op when no expectation was given', () => {
    assert.doesNotThrow(() => assertCriteriaCoverage(clusterVerdict(1), null));
  });

  it('scores a merged full-coverage verdict as one round', async () => {
    const h = harness({ verdict: clusterVerdict(4) });
    const envelope = await runAcceptanceEvalCli(
      [
        '--story',
        '4780',
        '--verdict',
        'merged.json',
        '--expected-criteria',
        '4',
      ],
      h.deps,
    );
    assert.equal(envelope.decision, 'proceed');
    assert.equal(h.seen.length, 1, 'the gate scores the merged verdict once');
  });

  it('rejects an unmerged cluster verdict before scoring, consuming no round', async () => {
    const h = harness({ verdict: clusterVerdict(2) });
    await assert.rejects(
      () =>
        runAcceptanceEvalCli(
          [
            '--story',
            '4780',
            '--verdict',
            'cluster-1.json',
            '--expected-criteria',
            '4',
          ],
          h.deps,
        ),
      (err) => {
        assert.match(
          err.message,
          /verdict covers 2 criteria but --expected-criteria is 4/,
        );
        assert.match(err.message, /ONE merged verdict -> ONE gate call/);
        assert.match(err.message, /No round was consumed/);
        return true;
      },
    );
    assert.deepEqual(h.seen, [], 'the scoring path must never be entered');
    assert.deepEqual(
      h.infos,
      [],
      'no envelope is printed for a refused verdict',
    );
  });

  it('preserves current behaviour exactly when the flag is omitted', async () => {
    const h = harness({ verdict: clusterVerdict(2) });
    const envelope = await runAcceptanceEvalCli(
      ['--story', '4780', '--verdict', 'cluster-1.json'],
      h.deps,
    );
    assert.equal(envelope.decision, 'proceed');
    assert.equal(h.seen.length, 1);
  });
});

/**
 * Story #4874 — reading a verdict is not a round.
 *
 * The round is counted off the Story's signal ledger, and every invocation
 * used to append one, so simply *re-reading* an existing verdict consumed
 * the cap and could turn a `redraft` into a `block` with no work in
 * between. These exercise the real ledger resolver (its `readFile` seam
 * injected) through `runAcceptanceEval`, so the replay guard is tested
 * end-to-end rather than stubbed away.
 */
describe('runAcceptanceEval — replay guard (Story #4874)', () => {
  const config = { delivery: { acceptanceEval: { maxRounds: 2 } } };

  const redraftVerdict = {
    storyId: 4874,
    schemaVersion: 1,
    round: 1,
    criteria: [
      { index: 0, criterion: 'AC-1', verdict: 'met', evidence: 'test passes' },
      { index: 1, criterion: 'AC-2', verdict: 'unmet', evidence: 'no test' },
    ],
  };

  const reworkedVerdict = {
    ...redraftVerdict,
    criteria: [
      redraftVerdict.criteria[0],
      { index: 1, criterion: 'AC-2', verdict: 'unmet', evidence: 'still red' },
    ],
  };

  /** A ledger holding exactly one prior round for `verdict`. */
  const ledgerFor = (verdict, round = 1) =>
    `${JSON.stringify({
      kind: 'acceptance-eval',
      storyId: 4874,
      details: {
        round,
        verdictFingerprint: computeVerdictFingerprint(verdict),
      },
    })}\n`;

  const depsOver = (ledgerText, appended) => ({
    resolveRoundFn: (args) =>
      resolveAcceptanceEvalRound({
        ...args,
        readFile: () => ledgerText,
        signalsPathResolver: () => '/fake/signals.ndjson',
      }),
    appendSignalFn: async ({ signal }) => {
      appended.push(signal);
      return true;
    },
  });

  it('does not advance the round when an existing verdict is re-read', async () => {
    const appended = [];
    const { envelope } = await runAcceptanceEval(
      {
        storyId: 4874,
        verdict: redraftVerdict,
        config,
        emitSignal: true,
      },
      depsOver(ledgerFor(redraftVerdict), appended),
    );
    assert.equal(envelope.round, 1);
    assert.equal(envelope.replay, true);
  });

  it('appends no signal on a replay, so observation is free', async () => {
    const appended = [];
    const { envelope } = await runAcceptanceEval(
      {
        storyId: 4874,
        verdict: redraftVerdict,
        config,
        emitSignal: true,
      },
      depsOver(ledgerFor(redraftVerdict), appended),
    );
    assert.deepEqual(appended, []);
    assert.equal(envelope.signalEmitted, false);
  });

  it('keeps a redraft a redraft however many times it is read', async () => {
    const ledger = ledgerFor(redraftVerdict);
    for (let i = 0; i < 4; i += 1) {
      const appended = [];
      const { envelope, exitCode } = await runAcceptanceEval(
        {
          storyId: 4874,
          verdict: redraftVerdict,
          config,
          emitSignal: true,
        },
        depsOver(ledger, appended),
      );
      assert.equal(envelope.decision, 'redraft');
      assert.equal(envelope.capReached, false);
      assert.equal(exitCode, 0);
    }
  });

  it('advances the round for a genuine re-evaluation after new work', async () => {
    const appended = [];
    const { envelope, exitCode } = await runAcceptanceEval(
      {
        storyId: 4874,
        verdict: reworkedVerdict,
        config,
        emitSignal: true,
      },
      depsOver(ledgerFor(redraftVerdict), appended),
    );
    assert.equal(envelope.round, 2);
    assert.equal(envelope.replay, false);
    assert.equal(envelope.decision, 'block');
    assert.equal(exitCode, 1);
    assert.equal(appended.length, 1);
    assert.equal(
      appended[0].details.verdictFingerprint,
      computeVerdictFingerprint(reworkedVerdict),
    );
  });

  it('scores the first evaluation as round 1 against an empty ledger', async () => {
    const appended = [];
    const { envelope } = await runAcceptanceEval(
      { storyId: 4874, verdict: redraftVerdict, config, emitSignal: true },
      depsOver('', appended),
    );
    assert.equal(envelope.round, 1);
    assert.equal(envelope.replay, false);
    assert.equal(appended.length, 1);
  });
});
