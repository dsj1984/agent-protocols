// tests/baselines/scope.test.js
//
// Story #1962 / Task #1970 — Lock the precedence ladder for the unified
// `resolveScope({kind, configScope, configRef, envScope, envRef})` helper.
// The check-baselines dispatcher calls it exactly once per gate per run;
// the wrong precedence here silently changes which ref every gate compares
// against.
//
// Story #4922 — the CLI/operator-override layer (`cliFlags.fullScope`,
// `cliFlags.changedSinceRef`) and the `cliFlags.changedFiles` → `files`
// plumbing were removed. Nothing in production ever populated them; only
// this file did, which is how a shipped `--full-scope` / `--changed-since`
// contract that `check-baselines.js` never implemented stayed green for
// nine Stories. The tests below now assert the layer is GONE — a resolver
// that starts honouring those keys again would break these.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveScope } from '../../.agents/scripts/lib/baselines/scope.js';

describe('resolveScope — full mode (acceptance)', () => {
  it("returns mode='full', ref=null when configScope='full'", () => {
    const r = resolveScope({ kind: 'lint', configScope: 'full' });
    assert.equal(r.kind, 'lint');
    assert.equal(r.mode, 'full');
    assert.equal(r.ref, null);
    assert.equal(r.source, 'config:gateScoping.scope=full');
  });

  it("env BASELINE_SCOPE='full' forces mode='full' over config diff", () => {
    const r = resolveScope({
      kind: 'coverage',
      configScope: 'diff',
      configRef: 'epic/1943',
      envScope: 'full',
    });
    assert.equal(r.mode, 'full');
    assert.equal(r.ref, null);
    assert.equal(r.source, 'env:BASELINE_SCOPE=full');
  });

  it('returns a frozen result so callers cannot mutate the resolution', () => {
    const r = resolveScope({ kind: 'lint', configScope: 'full' });
    assert.ok(Object.isFrozen(r));
  });
});

describe('resolveScope — precedence layers', () => {
  it('env BASELINE_REF beats config', () => {
    const r = resolveScope({
      kind: 'lighthouse',
      configScope: 'diff',
      configRef: 'main',
      envRef: 'origin/main',
    });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'origin/main');
    assert.equal(r.source, 'env:BASELINE_REF');
  });

  it('config gateScoping.diffRef beats default', () => {
    const r = resolveScope({
      kind: 'maintainability',
      configScope: 'diff',
      configRef: 'epic/1943',
    });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'epic/1943');
    assert.equal(r.source, 'config:gateScoping.diffRef');
  });

  it('falls back to diff against main when nothing is configured', () => {
    const r = resolveScope({ kind: 'crap' });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'default');
  });
});

describe('resolveScope — missing-ref fallback', () => {
  it('config scope=diff with no diffRef falls back to ref=main', () => {
    const r = resolveScope({ kind: 'lint', configScope: 'diff' });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'config:gateScoping.scope=diff');
  });

  it("env scope='diff' with no envRef falls back to ref=main", () => {
    const r = resolveScope({ kind: 'coverage', envScope: 'diff' });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'env:BASELINE_SCOPE=diff');
  });

  it('treats empty-string ref as missing (not a valid override)', () => {
    const r = resolveScope({
      kind: 'lint',
      configScope: 'diff',
      configRef: '',
      envRef: '',
    });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'config:gateScoping.scope=diff');
  });
});

describe('resolveScope — the operator-override layer is gone (#4922)', () => {
  it('does not ship a files Set — no consumer ever read one', () => {
    const r = resolveScope({ kind: 'lint', configScope: 'diff' });
    assert.equal(
      Object.hasOwn(r, 'files'),
      false,
      'resolveScope must not advertise a `files` set: the only reader of a ' +
        'scope-scoped file list is mergeRowsByScope, fed by the refresh ' +
        "service's own resolver",
    );
  });

  it('ignores a cliFlags.fullScope override entirely', () => {
    const r = resolveScope({
      kind: 'crap',
      configScope: 'diff',
      configRef: 'main',
      cliFlags: { fullScope: true },
    });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'config:gateScoping.diffRef');
  });

  it('ignores a cliFlags.changedSinceRef override entirely', () => {
    const r = resolveScope({
      kind: 'mutation',
      configScope: 'diff',
      configRef: 'main',
      cliFlags: { changedSinceRef: 'epic/1943' },
    });
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'config:gateScoping.diffRef');
  });

  it('does not read env values nested under cliFlags', () => {
    // The dispatcher now passes envScope/envRef at the top level. A caller
    // still nesting them under cliFlags gets the default, loudly, rather
    // than a silently half-resolved scope.
    const r = resolveScope({
      kind: 'lint',
      cliFlags: { envScope: 'full', envRef: 'origin/main' },
    });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'default');
  });
});

describe('resolveScope — input hardening', () => {
  it('coerces missing/blank kind to "unknown"', () => {
    const r = resolveScope({});
    assert.equal(r.kind, 'unknown');
  });

  it('ignores unknown configScope values (treated as "not specified")', () => {
    const r = resolveScope({
      kind: 'lint',
      configScope: 'sometimes',
      configRef: 'main',
    });
    // Scope mode unspecified but configRef present → diff against configRef.
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'config:gateScoping.diffRef');
  });

  it('ignores unknown envScope values', () => {
    const r = resolveScope({ kind: 'lint', envScope: 'partial' });
    assert.equal(r.mode, 'diff');
    assert.equal(r.ref, 'main');
    assert.equal(r.source, 'default');
  });
});
