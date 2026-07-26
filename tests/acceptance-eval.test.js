import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runAcceptanceEvalCli,
  validateVerdict,
} from '../.agents/scripts/acceptance-eval.js';

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
