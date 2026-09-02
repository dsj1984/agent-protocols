/**
 * tests/single-story-close-flag-contract.test.js
 *
 * Story #5100 — `--help` is the flag contract, so the descriptor must be TRUE.
 *
 * `tests/enforcement/workflow-script-help.test.js` (Story #4750) asserts that
 * every workflow-invoked script *answers* `--help`. It cannot assert that what
 * the script says is honoured, and that gap minted two phantom flags on this
 * CLI: `--dry-run` and `--no-evidence` were advertised, parsed into a field
 * nothing read, and silently ignored — so a "dry run" performed a real
 * base-sync merge and could leave the Story `agent::blocked`.
 *
 * The two halves below close that gap for this CLI:
 *
 *   1. every advertised flag maps to an option `parseCloseOptions` actually
 *      returns, so re-adding a phantom flag fails here; and
 *   2. the retired flags are rejected rather than ignored — `parseSprintArgs`
 *      runs `parseArgs` with `strict: false`, so deletion ALONE would leave
 *      `--dry-run` silently absorbed and the close running for real.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertNoRetiredFlags,
  parseCloseOptions,
} from '../.agents/scripts/lib/orchestration/single-story-close/phases/options.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CLI = path.join(REPO_ROOT, '.agents/scripts/single-story-close.js');

/**
 * The advertised surface, read off the real `--help` output rather than the
 * source, because the rendered text is what an operator actually reads.
 * Descriptions wrap onto deeper-indented continuation lines, so anchoring on
 * exactly two leading spaces takes flags and never prose that mentions one.
 */
function advertisedFlags() {
  const help = execFileSync(process.execPath, [CLI, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return help
    .split('\n')
    .map((line) => /^ {2}(--[a-z][a-z0-9-]*)/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

/**
 * Advertised flag → the `parseCloseOptions` key that carries it.
 *
 * Deliberately explicit rather than a camelCase derivation: three flags are
 * renamed on the way through (`--wait-merge` becomes `waitForMergeExplicit`
 * because the resolved value is not knowable at parse time), and a derivation
 * that tolerated those would also tolerate a flag mapped to nothing. Adding a
 * flag means adding a row here with a key that really exists.
 */
const FLAG_TO_OPTION = Object.freeze({
  '--story': 'storyId',
  '--cwd': 'cwd',
  '--skip-validation': 'skipValidation',
  '--skip-sync': 'skipSync',
  '--no-auto-merge': 'noAutoMerge',
  '--wait-merge': 'waitForMergeExplicit',
  '--no-wait-merge': 'noWaitForMerge',
  '--max-wait-seconds': 'maxWaitSeconds',
  '--merge-watch-mode': 'mergeWatchMode',
  '--override-review-block': 'overrideReviewBlock',
});

/** Answered by `runAsCli` before `main`, so no pipeline option backs it. */
const FRAMEWORK_FLAGS = new Set(['--help']);

const RETIRED = ['--dry-run', '--no-evidence'];

describe('single-story-close --help advertises only flags the pipeline honours', () => {
  it('maps every advertised flag to an option parseCloseOptions returns', () => {
    // An injected `storyId` makes this argv-independent, so the test runner's
    // own flags cannot leak into the parse.
    const options = parseCloseOptions({ storyIdParam: 5100 });
    const unbacked = advertisedFlags()
      .filter((flag) => !FRAMEWORK_FLAGS.has(flag))
      .filter((flag) => {
        const key = FLAG_TO_OPTION[flag];
        return key === undefined || !(key in options);
      });
    assert.deepEqual(
      unbacked,
      [],
      `--help advertises flag(s) no close option carries: ${unbacked.join(', ')}. ` +
        'Wire the flag through parseCloseOptions, or drop it from the usage descriptor.',
    );
  });

  for (const flag of RETIRED) {
    it(`no longer advertises ${flag}`, () => {
      assert.ok(
        !advertisedFlags().includes(flag),
        `${flag} was never implemented in this pipeline; it must not be advertised.`,
      );
    });
  }
});

describe('single-story-close rejects the retired flags instead of ignoring them', () => {
  for (const flag of RETIRED) {
    it(`throws on a bare ${flag}`, () => {
      assert.throws(
        () => assertNoRetiredFlags(['--story', '5100', flag]),
        (err) =>
          err.message.includes(flag) &&
          /nothing was mutated/i.test(err.message),
        `${flag} must fail closed, naming itself and stating nothing was mutated.`,
      );
    });

    it(`throws on ${flag}=value`, () => {
      assert.throws(
        () => assertNoRetiredFlags([`${flag}=true`]),
        new RegExp(flag),
      );
    });
  }

  it('lets a legitimate close argv through untouched', () => {
    assert.doesNotThrow(() =>
      assertNoRetiredFlags([
        '--story',
        '5100',
        '--cwd',
        '/repo',
        '--merge-watch-mode',
        'async',
        '--no-wait-merge',
      ]),
    );
  });

  it('does not trip on a positional that merely contains the text', () => {
    assert.doesNotThrow(() =>
      assertNoRetiredFlags(['--cwd', '/tmp/repo--dry-run/checkout']),
    );
  });

  /**
   * The vacuity guard. Deleting a flag from the descriptor does NOT make the
   * CLI reject it — `parseArgs` runs with `strict: false`. This asserts the
   * shape the guard defends against: an argv the parser happily absorbs.
   */
  it('the shared parser absorbs a retired flag instead of rejecting it', async () => {
    const { parseSprintArgs } = await import(
      '../.agents/scripts/lib/cli-args.js'
    );
    const parsed = parseSprintArgs([
      process.execPath,
      CLI,
      '--story',
      '5100',
      '--dry-run',
    ]);
    // The parse SUCCEEDS with a retired flag present: `strict: false` absorbs
    // it and hands back a valid options bag, so the close would run for real.
    // That is the hazard `assertNoRetiredFlags` exists to cover.
    assert.equal(parsed.storyId, 5100);
  });
});

/**
 * The wiring, not just the helper.
 *
 * These drive `parseCloseOptions` through its argv door — the path the CLI
 * actually takes — so deleting the `assertNoRetiredFlags` call from it fails
 * here. Asserting only against the exported helper would still pass with the
 * call site gone, which is a vacuous guard: the helper stays correct and is
 * simply never consulted. Driving the real CLI as a subprocess would be more
 * faithful still, but a regression there performs a REAL close, so the hazard
 * is reproduced in-process where a failure costs nothing.
 */
describe('parseCloseOptions rejects retired flags on its argv door', () => {
  /** Run `fn` with `process.argv` stubbed, always restoring it. */
  function withArgv(tail, fn) {
    const saved = process.argv;
    process.argv = [process.execPath, CLI, ...tail];
    try {
      return fn();
    } finally {
      process.argv = saved;
    }
  }

  for (const flag of RETIRED) {
    it(`throws when argv carries ${flag}`, () => {
      assert.throws(
        () => withArgv(['--story', '5100', flag], () => parseCloseOptions({})),
        new RegExp(`${flag} was retired`),
        `parseCloseOptions must reject ${flag}; without this the guard can be ` +
          'unwired while its unit tests still pass.',
      );
    });
  }

  it('still parses a clean argv through the same door', () => {
    const options = withArgv(['--story', '5100', '--skip-sync'], () =>
      parseCloseOptions({}),
    );
    assert.equal(options.storyId, 5100);
    assert.equal(options.skipSync, true);
  });

  it('does not consult argv when the caller injects a storyId', () => {
    // An injecting caller's options must not be poisoned by the host process's
    // own flags — a test runner's argv is not close's input.
    const options = withArgv(['--dry-run'], () =>
      parseCloseOptions({ storyIdParam: 5100 }),
    );
    assert.equal(options.storyId, 5100);
  });
});

describe('the dead no-evidence slot is gone from the shared parser', () => {
  it('parseSprintArgs no longer surfaces noEvidence', async () => {
    const { parseSprintArgs } = await import(
      '../.agents/scripts/lib/cli-args.js'
    );
    const parsed = parseSprintArgs([process.execPath, CLI, '--story', '5100']);
    assert.ok(
      !('noEvidence' in parsed),
      'noEvidence had zero readers repo-wide; the working --no-evidence lives on the gate wrappers.',
    );
  });

  it('still surfaces dryRun, which single-story-init.js reads', async () => {
    const { parseSprintArgs } = await import(
      '../.agents/scripts/lib/cli-args.js'
    );
    const parsed = parseSprintArgs([
      process.execPath,
      CLI,
      '--story',
      '5100',
      '--dry-run',
    ]);
    assert.equal(parsed.dryRun, true);
  });
});
