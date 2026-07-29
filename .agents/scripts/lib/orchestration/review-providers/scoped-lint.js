/**
 * review-providers/scoped-lint.js — the scoped-lint surface of the native
 * review provider (extracted from `native.js` by Story #4839).
 *
 * ## Why this module exists
 *
 * The scoped-lint gate reported `executionFailed` — and therefore emitted zero
 * findings while the review reported clean — on 18 of 23 Beestera/swarm-os
 * Stories carrying friction (78%) and on 5 mandrel Stories. Measured
 * 2026-07-29, the cause was **not** environmental and **not** a parse failure.
 * Three defects in how the runners were invoked and reconciled produced the
 * same symptom:
 *
 * 1. **The markdown runner was never resolvable.** The provider spawned
 *    `npx --no markdownlint`, but the binary this project (and the consumer)
 *    installs is `markdownlint-cli2` — `markdownlint-cli2` is the package and
 *    the bin name; a bare `markdownlint` bin does not exist. `npx --no` with an
 *    unresolvable bin exits 1 printing `could not determine executable to run`
 *    and nothing else, so the summary parsed nothing and the gate degraded.
 *    The parser was already written for **cli2's** `Summary: N error(s)` line,
 *    so the invocation and the parser had never agreed. The `--ignore
 *    node_modules` flag was likewise `markdownlint-cli` (v1) syntax, which
 *    cli2 does not accept. Fix: resolve the runner from what is actually
 *    installed and pass each candidate its own argument shape.
 *
 * 2. **One runner's failure poisoned the other's verdict.** The two runs were
 *    folded into a *single* `parseLintOutput` call over concatenated output and
 *    the maximum exit status. So the unresolvable markdown runner's exit 1
 *    became the verdict for biome too: any change set containing at least one
 *    `.md` file degraded the whole gate whenever biome itself had nothing to
 *    report — i.e. exactly the clean case the gate exists to confirm. Fix:
 *    classify each surface independently and merge structurally.
 *
 * 3. **Biome's "nothing in scope" exit was read as a failure.** `biome lint`
 *    exits 1 with `No files were processed in the specified paths.` when every
 *    supplied path is excluded by `biome.json` (`temp/`, `dist/`,
 *    `.worktrees/`, anything in the VCS ignore file). That is an empty scope,
 *    not a runner that could not execute. Fix: recognise the sentinel.
 *
 * ## What a degraded surface now produces
 *
 * `runScopedLint` still reports `executionFailed` — the friction-telemetry
 * emission in `native.js` is deliberately unchanged (Story #4699 routed an
 * unexecutable tool to telemetry so severity tiers reflect code findings only,
 * and that intent stands). It additionally reports a `degradations[]` array
 * naming **which** surface could not run and **why**, so the review outcome can
 * say "this gate did not run" instead of silently reading clean.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Paths these extensions land on the biome (code) runner. */
const CODE_EXTENSIONS = /\.(js|mjs|cjs|jsx|ts|tsx|json|jsonc)$/i;

/** npx's message when the requested bin cannot be resolved. */
const NPX_UNRESOLVABLE = /could not determine executable to run/i;

/** Biome's exit-1 message when every supplied path is config-excluded. */
const BIOME_EMPTY_SCOPE = /No files were processed in the specified paths/i;

/**
 * Markdown runners in preference order, each with the argument shape *it*
 * accepts. `markdownlint-cli2` takes bare paths/globs and rejects `--ignore`;
 * `markdownlint` (cli v1) takes `--ignore`. Explicit changed-file paths are
 * passed either way, so the v1 ignore flag is belt-and-braces only.
 */
const MARKDOWN_RUNNERS = Object.freeze([
  Object.freeze({ bin: 'markdownlint-cli2', extraArgs: Object.freeze([]) }),
  Object.freeze({
    bin: 'markdownlint',
    extraArgs: Object.freeze(['--ignore', 'node_modules']),
  }),
]);

/** Reason codes carried on a degradation record. */
const DEGRADATION_REASONS = Object.freeze({
  RUNNER_NOT_INSTALLED: 'runner-not-installed',
  RUNNER_NOT_RESOLVABLE: 'runner-not-resolvable',
  UNPARSEABLE_OUTPUT: 'unparseable-output',
});

/**
 * Spawn one lint runner through `npx --no` (never install on the fly).
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function spawnLintRunner(bin, args, cwd) {
  const result = spawnSync('npx', ['--no', bin, ...args], {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Pure-ish: pick the first markdown runner whose bin is actually installed
 * under `<cwd>/node_modules/.bin`. Returns `null` when none is — an honest
 * "this surface has no runner" that the caller reports rather than silently
 * folding into a generic parse failure.
 *
 * The disk probe (rather than "spawn and see") is what makes the failure
 * *nameable*: `npx --no <missing-bin>` yields only a generic npm error, which
 * is precisely how the defect hid for months.
 *
 * Not exported: it is reachable — and asserted — through {@link runScopedLint},
 * whose `existsFn` seam drives every resolution branch.
 *
 * @param {string} cwd
 * @param {(p: string) => boolean} [existsFn]  Injected for testing.
 * @returns {{ bin: string, extraArgs: ReadonlyArray<string> }|null}
 */
function resolveMarkdownRunner(cwd, existsFn = existsSync) {
  for (const candidate of MARKDOWN_RUNNERS) {
    const base = path.join(cwd, 'node_modules', '.bin', candidate.bin);
    if (existsFn(base)) return candidate;
    if (
      process.platform === 'win32' &&
      (existsFn(`${base}.cmd`) || existsFn(`${base}.ps1`))
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Pure: split changed paths into the file lists each lint runner consumes.
 *
 * @param {string[]} changedFiles
 * @returns {{ code: string[], md: string[] }}
 */
export function partitionFilesForLint(changedFiles) {
  const code = [];
  const md = [];
  for (const f of changedFiles) {
    if (CODE_EXTENSIONS.test(f)) code.push(f);
    else if (/\.md$/i.test(f)) md.push(f);
  }
  return { code, md };
}

/**
 * Pure: classify **one** runner's result into a summary.
 *
 * Handles the reporter formats composing `npm run lint` here:
 *   - Biome: `Found N error(s).` / `Found N warning(s).`
 *   - markdownlint-cli2: a trailing `Summary: N error(s)` line.
 *
 * A non-zero exit whose output matches no known reporter format is "could not
 * classify" → `executionFailed: true`, with `reason` naming what was actually
 * observed. Biome's empty-scope exit is recognised separately as
 * `emptyScope` — nothing to lint is not a broken runner.
 *
 * @param {{ status?: number, stdout?: string, stderr?: string }} result
 * @returns {{ errors: number, warnings: number, parsed: boolean, executionFailed: boolean, emptyScope: boolean, reason: string|null }}
 */
export function parseLintOutput(result) {
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  let errors = 0;
  let warnings = 0;
  let parsed = false;

  for (const m of combined.matchAll(/Found\s+(\d+)\s+error/gi)) {
    errors += Number(m[1]);
    parsed = true;
  }
  for (const m of combined.matchAll(/Found\s+(\d+)\s+warning/gi)) {
    warnings += Number(m[1]);
    parsed = true;
  }
  const mdSummary = combined.match(/Summary:\s+(\d+)\s+error/i);
  if (mdSummary) {
    errors += Number(mdSummary[1]);
    parsed = true;
  }

  const failedExit = !parsed && (result.status ?? 0) !== 0;
  const emptyScope = failedExit && BIOME_EMPTY_SCOPE.test(combined);
  const executionFailed = failedExit && !emptyScope;
  const reason = executionFailed
    ? NPX_UNRESOLVABLE.test(combined)
      ? DEGRADATION_REASONS.RUNNER_NOT_RESOLVABLE
      : DEGRADATION_REASONS.UNPARSEABLE_OUTPUT
    : null;

  return { errors, warnings, parsed, executionFailed, emptyScope, reason };
}

/**
 * Pure: merge per-surface summaries into the gate's single summary. Counts add;
 * `executionFailed` is the OR across surfaces; each failed surface contributes
 * one degradation record naming itself. Merging *summaries* rather than raw
 * output is what stops one runner's failure from becoming the other's verdict.
 *
 * @param {Array<{ surface: string, summary: ReturnType<typeof parseLintOutput> }>} surfaces
 */
function mergeSurfaceSummaries(surfaces) {
  let errors = 0;
  let warnings = 0;
  let parsed = false;
  let executionFailed = false;
  const degradations = [];

  for (const { surface, summary } of surfaces) {
    errors += summary.errors;
    warnings += summary.warnings;
    if (summary.parsed) parsed = true;
    if (summary.executionFailed) {
      executionFailed = true;
      degradations.push({
        surface,
        reason: summary.reason ?? DEGRADATION_REASONS.UNPARSEABLE_OUTPUT,
      });
    }
  }

  return {
    errors,
    warnings,
    parsed,
    executionFailed,
    skipped: false,
    mode: 'changed-only',
    degradations,
  };
}

/**
 * Run lint scoped to the changed surface only.
 *
 * @param {string[]} changedFiles
 * @param {string} cwd
 * @param {typeof spawnLintRunner} [runnerFn]
 * @param {{ existsFn?: (p: string) => boolean }} [deps]  Test seam for runner resolution.
 * @returns {{ errors: number, warnings: number, parsed: boolean, skipped: boolean, mode: 'changed-only'|'off', executionFailed: boolean, degradations: Array<{ surface: string, reason: string }> }}
 */
export function runScopedLint(
  changedFiles,
  cwd,
  runnerFn = spawnLintRunner,
  deps = {},
) {
  const { existsFn = existsSync } = deps;
  const { code, md } = partitionFilesForLint(changedFiles);
  if (code.length === 0 && md.length === 0) {
    return {
      errors: 0,
      warnings: 0,
      parsed: false,
      skipped: true,
      mode: 'changed-only',
      executionFailed: false,
      degradations: [],
    };
  }

  const surfaces = [];
  if (code.length > 0) {
    surfaces.push({
      surface: 'biome',
      summary: parseLintOutput(runnerFn('biome', ['lint', ...code], cwd)),
    });
  }
  if (md.length > 0) {
    const runner = resolveMarkdownRunner(cwd, existsFn);
    if (runner === null) {
      surfaces.push({
        surface: 'markdownlint',
        summary: {
          errors: 0,
          warnings: 0,
          parsed: false,
          executionFailed: true,
          emptyScope: false,
          reason: DEGRADATION_REASONS.RUNNER_NOT_INSTALLED,
        },
      });
    } else {
      surfaces.push({
        surface: runner.bin,
        summary: parseLintOutput(
          runnerFn(runner.bin, [...md, ...runner.extraArgs], cwd),
        ),
      });
    }
  }

  return mergeSurfaceSummaries(surfaces);
}
