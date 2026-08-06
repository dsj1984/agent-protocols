/**
 * tests/lib/checks/registry-reads-produced-state.test.js — Story #5004.
 *
 * A self-healing check is only a gate if `assembleState()` can actually feed
 * it. Five shipped modules could not fire under any scope, because each read
 * a state key the assembler has never produced:
 *
 *   push-hook-parity            → state.gates.{biome,miGate}
 *   windows-coverage-noise-floor→ state.coverage
 *   baseline-drift-main-checkout→ state.fs.worktreePaths
 *   worktree-residue-biome      → state.fs.worktreeBiomeOrphans
 *   worktree-bootstrap-env      → state.fs.worktreeBootstrapStatus
 *
 * Every one of their `detect()` bodies returns `null` on the first read, so
 * `/diagnose`'s default scope was guaranteed empty and three `story-close`
 * blockers could never block. They were deleted; this test is what stops the
 * shape coming back. A check that needs a new probe adds it to `SCOPE_KEYS` in
 * `state.js` at the same time — which is the whole point of the deliberate
 * per-scope probe surface documented there.
 *
 * Scope note: this reads module SOURCE rather than executing `detect()`,
 * because the failure mode is a read that silently yields `undefined` — there
 * is no runtime signal to observe. `state.js` is likewise parsed for its
 * `SCOPE_KEYS` literal so the two cannot drift.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { getScopeKeys } from '../../../.agents/scripts/lib/checks/state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKS_DIR = path.resolve(HERE, '../../../.agents/scripts/lib/checks');

/** Runner infrastructure, not checks — mirrors `NON_CHECK_FILES` in index.js. */
const NON_CHECK_FILES = new Set(['index.js', 'state.js']);

/**
 * Top-level fields `assembleState()` always sets, independent of scope.
 * See the object it returns in `state.js`.
 */
const ALWAYS_PRESENT = new Set(['cwd', 'scope', 'git', 'fs', 'env']);

/**
 * Optional fields a CALLER may inject on top of the assembled state. Each is
 * read behind a default, so a check that reads one still fires without it.
 * Adding an entry here is a claim that the field is optional — not that the
 * assembler produces it.
 */
const CALLER_INJECTED_OPTIONAL = new Set([
  // loop-health: test seam for the resolved config.
  'config',
  // story-init-not-backgrounded / subagent-agent-tool-required: scan root
  // override, defaulting to state.cwd.
  'scanRoot',
  // subagent-agent-tool-required: harness-depth ceiling override.
  'supportedDepth',
]);

function checkModules() {
  return readdirSync(CHECKS_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !NON_CHECK_FILES.has(f))
    .sort();
}

/**
 * Collect `state.a` / `state?.a` and `state.a.b` / `state?.a?.b` reads from a
 * module's source.
 *
 * @param {string} source
 * @returns {{ top: Set<string>, nested: Set<string> }}
 */
function collectStateReads(source) {
  const top = new Set();
  const nested = new Set();
  const re = /\bstate\??\.([A-Za-z_$][\w$]*)(?:\??\.([A-Za-z_$][\w$]*))?/g;
  for (const m of source.matchAll(re)) {
    top.add(m[1]);
    if (m[2]) nested.add(`${m[1]}.${m[2]}`);
  }
  return { top, nested };
}

describe('checks registry reads only state assembleState() produces', () => {
  const producedPaths = new Set(Object.values(getScopeKeys()).flat());

  it('the probe surface itself is non-empty', () => {
    assert.ok(
      producedPaths.size > 0,
      'SCOPE_KEYS produced no dotted probe paths — the assertions below would pass vacuously.',
    );
    assert.ok(checkModules().length > 0, 'no check modules discovered');
  });

  for (const file of checkModules()) {
    it(`${file} reads no unproduced state field`, () => {
      const source = readFileSync(path.join(CHECKS_DIR, file), 'utf8');
      const { top, nested } = collectStateReads(source);

      const unknownTop = [...top].filter(
        (field) =>
          !ALWAYS_PRESENT.has(field) && !CALLER_INJECTED_OPTIONAL.has(field),
      );
      assert.deepEqual(
        unknownTop,
        [],
        `${file} reads state.${unknownTop.join(', state.')} — assembleState() ` +
          'never sets it, so detect() returns null on every scope. Add the ' +
          'probe to SCOPE_KEYS in state.js, or declare the field optional in ' +
          'CALLER_INJECTED_OPTIONAL with the default it falls back to.',
      );

      const unknownNested = [...nested].filter(
        (dotted) =>
          ['git', 'fs', 'env'].includes(dotted.split('.')[0]) &&
          !producedPaths.has(dotted),
      );
      assert.deepEqual(
        unknownNested,
        [],
        `${file} reads ${unknownNested.join(', ')} — no scope in SCOPE_KEYS ` +
          'declares that probe key, so the read is always undefined. Add the ' +
          'key to the scopes this check declares.',
      );
    });
  }
});
