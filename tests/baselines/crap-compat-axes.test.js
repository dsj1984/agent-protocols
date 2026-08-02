import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertBaselineCompatible,
  CRAP_COMPAT_AXES,
  envelopeExtras,
  evaluateBaselineCompatibility,
} from '../../.agents/scripts/lib/baselines/kinds/crap.js';

// The stamp is read through the production door the writer uses, not a
// second exported constant — so a drift between what the writer stamps and
// what the compat axis expects would fail this suite rather than hide.
const SCORING_SEMANTICS = envelopeExtras().scoringSemantics;

// ---------------------------------------------------------------------------
// crap-compat-axes.test.js — Story #2467 / Task #2491.
//
// Exercises the declarative CRAP_COMPAT_AXES table and the reduce-based
// rewrite of evaluateBaselineCompatibility. Each axis is asserted both in
// isolation (its `check` function alone) and through the public reducer so
// the table-driven contract is exact.
// ---------------------------------------------------------------------------

function axis(name) {
  const found = CRAP_COMPAT_AXES.find((a) => a.name === name);
  assert.ok(found, `axis ${name} must exist`);
  return found;
}

// Story #4866: the ts-transpiler axis is scoped to baselines that actually
// contain transpiled sources, so the shared fixture carries one TS row. A
// transpiler change moves TS row coordinates and nothing else.
// Story #4901: a current writer stamps `provenanceStamped`, so a baseline
// that is valid in every other respect carries it too — without it the
// `provenance-unstamped` axis would (correctly) refuse this TS-row fixture.
const VALID_BASELINE = {
  escomplexVersion: '0.8.0',
  kernelVersion: '0.8.0',
  tsTranspilerVersion: '5.4.0',
  scoringSemantics: SCORING_SEMANTICS,
  provenanceStamped: true,
  rows: [{ path: 'src/a.ts', method: 'run', startLine: 3, crap: 2 }],
};

const JS_ONLY_BASELINE = {
  ...VALID_BASELINE,
  rows: [{ path: 'src/a.js', method: 'run', startLine: 3, crap: 2 }],
};

const VALID_CTX = {
  baseline: VALID_BASELINE,
  runningKernelVersion: '0.8.0',
  runningEscomplexVersion: '0.8.0',
  runningTsTranspilerVersion: '5.4.0',
};

describe('CRAP_COMPAT_AXES table shape', () => {
  it('exposes name + severity + check on every axis', () => {
    for (const a of CRAP_COMPAT_AXES) {
      assert.equal(typeof a.name, 'string');
      assert.ok(
        a.severity === 'fatal' || a.severity === 'warn',
        `axis ${a.name} must declare severity`,
      );
      assert.equal(typeof a.check, 'function');
    }
  });
});

describe('CRAP_COMPAT_AXES — per-axis check()', () => {
  it('missing-baseline fires when baseline is null', () => {
    assert.match(
      axis('missing-baseline').check({ baseline: null }),
      /no baseline found/,
    );
    assert.equal(axis('missing-baseline').check(VALID_CTX), null);
  });

  it('escomplex-mismatch fires when scorer version drifts', () => {
    assert.match(
      axis('escomplex-mismatch').check({
        ...VALID_CTX,
        runningEscomplexVersion: '0.9.0',
      }),
      /scorer changed from 0\.8\.0 to 0\.9\.0/,
    );
    assert.equal(axis('escomplex-mismatch').check(VALID_CTX), null);
  });

  it('kernel-drift fires when kernel version drifts', () => {
    assert.match(
      axis('kernel-drift').check({
        ...VALID_CTX,
        runningKernelVersion: '0.9.0',
      }),
      /kernelVersion drift/,
    );
    assert.equal(axis('kernel-drift').check(VALID_CTX), null);
  });

  it('ts-transpiler-drift fires when ts version drifts', () => {
    assert.match(
      axis('ts-transpiler-drift').check({
        ...VALID_CTX,
        runningTsTranspilerVersion: '5.5.0',
      }),
      /tsTranspilerVersion changed/,
    );
    assert.equal(axis('ts-transpiler-drift').check(VALID_CTX), null);
  });

  it('ts-transpiler-drift passes when runningTsTranspilerVersion is unset', () => {
    assert.equal(
      axis('ts-transpiler-drift').check({
        ...VALID_CTX,
        runningTsTranspilerVersion: undefined,
      }),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// Story #4866 — the transpiler axis stops being advisory, and stops being
// dead. A TS row's startLine is an original-source coordinate only because
// the transpiler's sourcemap said so, and that coordinate is half the
// `path::method@startLine` identity key — so a transpiler change can move
// every TS row's key while nothing about the code changed.
// ---------------------------------------------------------------------------

describe('ts-transpiler-drift axis — coordinate-invalidating (AC-7)', () => {
  it('is fatal, not an advisory warning', () => {
    assert.equal(axis('ts-transpiler-drift').severity, 'fatal');
  });

  it('names the coordinate consequence and the re-seed remedy', () => {
    const message = axis('ts-transpiler-drift').check({
      ...VALID_CTX,
      runningTsTranspilerVersion: '5.5.0',
    });
    assert.match(message, /baseline=5\.4\.0 running=5\.5\.0/);
    assert.match(message, /identity key/);
    assert.match(message, /crap:update -- --full-scope/);
    assert.match(message, /baseline-refresh:/);
  });

  it('fails the reduce closed rather than accumulating a warning', () => {
    const out = evaluateBaselineCompatibility({
      ...VALID_CTX,
      runningTsTranspilerVersion: '5.5.0',
    });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.equal(out.kind, 'ts-transpiler-drift');
  });

  it('leaves a pure-JavaScript baseline alone — no TS coordinate to move', () => {
    // The Story's invariant. JavaScript coordinates ARE original-source
    // coordinates; no sourcemap resolved them, so no transpiler bump can
    // invalidate them. Failing a JS-only repo's gate on a TS bump would be a
    // pure false positive.
    assert.equal(
      axis('ts-transpiler-drift').check({
        ...VALID_CTX,
        baseline: JS_ONLY_BASELINE,
        runningTsTranspilerVersion: '5.5.0',
      }),
      null,
    );
  });

  it('skips an UNSTAMPED baseline rather than failing it for want of evidence', () => {
    // The stamp landed in this Story. Every baseline written before it has no
    // tsTranspilerVersion at all, and treating that absence as a mismatch
    // would fail every pre-existing baseline closed on no evidence.
    assert.equal(
      axis('ts-transpiler-drift').check({
        ...VALID_CTX,
        baseline: { ...VALID_BASELINE, tsTranspilerVersion: undefined },
        runningTsTranspilerVersion: '5.5.0',
      }),
      null,
    );
  });

  it("treats the '0.0.0' unknown-environment sentinel as unstamped, not as a version", () => {
    // '0.0.0' means "typescript was not resolvable here". Comparing it as a
    // real release would turn a missing dependency into a coordinate change.
    assert.equal(
      axis('ts-transpiler-drift').check({
        ...VALID_CTX,
        baseline: { ...VALID_BASELINE, tsTranspilerVersion: '0.0.0' },
        runningTsTranspilerVersion: '5.5.0',
      }),
      null,
    );
    assert.equal(
      axis('ts-transpiler-drift').check({
        ...VALID_CTX,
        runningTsTranspilerVersion: '0.0.0',
      }),
      null,
    );
  });
});

describe('assertBaselineCompatible — the production door (AC-7)', () => {
  it('reaches the ts-transpiler axis, not the scoring stamp alone', () => {
    // Before this Story the axis was reachable only from its own unit test:
    // nothing in production called evaluateBaselineCompatibility, and this
    // door deliberately checked scoring-semantics-drift only.
    const message = assertBaselineCompatible(VALID_BASELINE, {
      runningTsTranspilerVersion: '5.5.0',
    });
    assert.match(message, /tsTranspilerVersion changed/);
  });

  it('passes a matching transpiler', () => {
    assert.equal(
      assertBaselineCompatible(VALID_BASELINE, {
        runningTsTranspilerVersion: '5.4.0',
      }),
      null,
    );
  });

  it('reports the scoring-semantics stamp first when both axes fire', () => {
    const legacy = { ...VALID_BASELINE };
    delete legacy.scoringSemantics;
    const message = assertBaselineCompatible(legacy, {
      runningTsTranspilerVersion: '5.5.0',
    });
    assert.match(message, /scoring semantics changed/);
  });
});

describe('envelopeExtras — what the writer stamps (AC-7)', () => {
  it('stamps the running transpiler version alongside the scoring semantics', () => {
    const extras = envelopeExtras();
    assert.equal(typeof extras.scoringSemantics, 'string');
    assert.equal(
      typeof extras.tsTranspilerVersion,
      'string',
      'without an on-disk stamp the ts-transpiler axis has nothing to ' +
        'compare and passes vacuously — which is how it stayed dead',
    );
  });
});

describe('evaluateBaselineCompatibility — reduce semantics', () => {
  it('returns ok=true with no warnings when everything matches', () => {
    const out = evaluateBaselineCompatibility(VALID_CTX);
    assert.deepEqual(out, { ok: true, warnings: [] });
  });

  it('short-circuits on missing-baseline before any other axis runs', () => {
    const out = evaluateBaselineCompatibility({
      baseline: null,
      runningKernelVersion: 'X',
      runningEscomplexVersion: 'Y',
      runningTsTranspilerVersion: 'Z',
    });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.equal(out.kind, 'missing-baseline');
    assert.match(out.message, /no baseline found/);
  });

  it('short-circuits on escomplex-mismatch (fatal) and ignores warn axes', () => {
    const out = evaluateBaselineCompatibility({
      ...VALID_CTX,
      runningEscomplexVersion: '0.9.0',
      runningKernelVersion: '9.9.9',
    });
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'escomplex-mismatch');
    assert.equal(out.exitCode, 1);
    assert.ok(!('warnings' in out));
  });

  it('accumulates kernel drift as a warning without failing', () => {
    const out = evaluateBaselineCompatibility({
      ...VALID_CTX,
      runningKernelVersion: '0.9.0',
    });
    assert.equal(out.ok, true);
    assert.equal(out.warnings.length, 1);
    assert.match(out.warnings[0], /kernelVersion drift/);
  });

  it('short-circuits on ts-transpiler drift ahead of the kernel warning', () => {
    // Story #4866 promoted the axis to fatal, so it no longer accumulates
    // alongside kernel drift — it stops the reduce.
    const out = evaluateBaselineCompatibility({
      ...VALID_CTX,
      runningKernelVersion: '0.9.0',
      runningTsTranspilerVersion: '5.5.0',
    });
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'ts-transpiler-drift');
  });
});

// ---------------------------------------------------------------------------
// Story #4775 — scoring-semantics stamp. `kernelVersion` and
// `escomplexVersion` both track the SAME upstream package, so a change to how
// this repo joins escomplex methods to istanbul coverage moves neither. The
// stamp is the only axis that can catch it, and it must fail CLOSED: rows
// scored by the old join are not comparable to rows scored by the new one, so
// an unstamped baseline is a re-baseline, never a silent comparison.
// ---------------------------------------------------------------------------

describe('scoring-semantics-drift axis', () => {
  it('is fatal, not a warning', () => {
    assert.equal(axis('scoring-semantics-drift').severity, 'fatal');
  });

  it('passes when the stamp matches the running semantics', () => {
    assert.equal(axis('scoring-semantics-drift').check(VALID_CTX), null);
    assert.equal(
      assertBaselineCompatible(VALID_BASELINE, {
        runningTsTranspilerVersion: '5.4.0',
      }),
      null,
    );
  });

  it('fires on an UNSTAMPED baseline (written by the previous scorer)', () => {
    const legacy = { ...VALID_BASELINE };
    delete legacy.scoringSemantics;
    const message = assertBaselineCompatible(legacy);
    assert.match(message, /scoring semantics changed/);
    assert.match(message, /<unstamped>/);
    assert.match(message, new RegExp(SCORING_SEMANTICS));
  });

  it('fires on a baseline stamped with different semantics', () => {
    const message = assertBaselineCompatible({
      ...VALID_BASELINE,
      scoringSemantics: 'coverage-join-v1',
    });
    assert.match(message, /coverage-join-v1/);
  });

  it('names the exact re-baseline command in its guidance', () => {
    const legacy = { ...VALID_BASELINE };
    delete legacy.scoringSemantics;
    const message = assertBaselineCompatible(legacy);
    assert.match(message, /npm run test:coverage/);
    assert.match(message, /crap:update -- --full-scope/);
    assert.match(message, /baseline-refresh:/);
  });

  it('fails the whole reduce closed, not as a warning', () => {
    const legacy = { ...VALID_BASELINE };
    delete legacy.scoringSemantics;
    const out = evaluateBaselineCompatibility({
      ...VALID_CTX,
      baseline: legacy,
    });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.equal(out.kind, 'scoring-semantics-drift');
  });

  it('treats a null baseline as the missing-baseline axis job, not its own', () => {
    assert.equal(assertBaselineCompatible(null), null);
  });
});

// ---------------------------------------------------------------------------
// Story #4901 — the pre-provenance baseline axis.
//
// The hole this closes is `ts-transpiler-drift`'s own deliberate exemption:
// it returns null for an unstamped baseline so that pre-existing baselines
// are not failed for no evidence. A pre-#4866 baseline is exactly that shape.
// ---------------------------------------------------------------------------
describe('provenance-unstamped axis (#4901)', () => {
  // The real pre-#4866 shape: neither stamp exists, because neither had been
  // written yet. Keeping `tsTranspilerVersion` here would be unfaithful AND
  // would let the earlier ts-transpiler axis short-circuit the reduce — the
  // very exemption that makes this axis necessary is what routes a genuine
  // pre-provenance baseline through to it.
  const PRE_PROVENANCE_BASELINE = (() => {
    const b = { ...VALID_BASELINE };
    delete b.provenanceStamped;
    delete b.tsTranspilerVersion;
    return b;
  })();

  it('is fatal, not a warning', () => {
    assert.equal(axis('provenance-unstamped').severity, 'fatal');
  });

  it('fires on a TS-row baseline with no provenanceStamped marker', () => {
    const message = axis('provenance-unstamped').check({
      baseline: PRE_PROVENANCE_BASELINE,
    });
    assert.match(message, /predates coordinate-provenance stamping/);
  });

  it('passes a baseline carrying the marker', () => {
    assert.equal(
      axis('provenance-unstamped').check({ baseline: VALID_BASELINE }),
      null,
    );
  });

  it('never fires on a pure-JavaScript baseline, marker or not', () => {
    // The load-bearing exemption: JS coordinates already ARE original-source
    // coordinates, so a JS-only baseline was never affected by #4866 and must
    // not be forced through a re-seed it does not need.
    const jsLegacy = { ...JS_ONLY_BASELINE };
    delete jsLegacy.provenanceStamped;
    assert.equal(
      axis('provenance-unstamped').check({ baseline: jsLegacy }),
      null,
    );
  });

  it('does not accept a truthy non-true marker', () => {
    // The marker is an assertion, not a hint — only the writer's literal
    // `true` counts, so a hand-edited string cannot wave a baseline through.
    const spoofed = { ...PRE_PROVENANCE_BASELINE, provenanceStamped: 'yes' };
    assert.match(
      axis('provenance-unstamped').check({ baseline: spoofed }),
      /predates coordinate-provenance stamping/,
    );
  });

  it('treats a null baseline as the missing-baseline axis job', () => {
    assert.equal(axis('provenance-unstamped').check({ baseline: null }), null);
  });

  it('names the exact re-seed command in its guidance', () => {
    const message = axis('provenance-unstamped').check({
      baseline: PRE_PROVENANCE_BASELINE,
    });
    assert.match(message, /npm run test:coverage/);
    assert.match(message, /crap:update -- --full-scope/);
    assert.match(message, /baseline-refresh:/);
  });

  it('is reachable through assertBaselineCompatible (the loaded-envelope door)', () => {
    // Without this registration the axis exists but nothing in production
    // reaches it — the exact shape of the #4866 gap it closes.
    const message = assertBaselineCompatible(PRE_PROVENANCE_BASELINE);
    assert.match(message, /predates coordinate-provenance stamping/);
  });

  it('fails the whole reduce closed', () => {
    const out = evaluateBaselineCompatibility({
      ...VALID_CTX,
      baseline: PRE_PROVENANCE_BASELINE,
    });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.equal(out.kind, 'provenance-unstamped');
  });
});

describe('envelopeExtras — provenance marker (#4901)', () => {
  it('stamps provenanceStamped: true so new baselines carry the assertion', () => {
    assert.equal(envelopeExtras().provenanceStamped, true);
  });
});
