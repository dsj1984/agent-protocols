#!/usr/bin/env node
/* node:coverage ignore file */
/**
 * Remote Bootstrap — boots the Claude remote-agent environment for a plan
 * or execute phase against an Epic.
 *
 * Invoked by `.github/workflows/epic-orchestrator.yml` (spec/decompose/execute
 * phases, routed by the triggering label) via the Claude remote-agent runner.
 * Steps:
 *   1. git clone the target repo into a working directory.
 *   2. Materialize `.env` from the optional `ENV_FILE` environment variable,
 *      emitting `::add-mask::` for each non-empty line so any accidental echo
 *      is redacted in logs.
 *   3. Run `npm ci` (lockfile-strict) with `--ignore-scripts`.
 *   4. Exec the phase-appropriate slash command so the engine takes over.
 *      The `--phase` flag (or `PHASE` env var) selects the command; execute
 *      is the default to preserve v5.14.0 behavior.
 *
 * Phase routing (post-v5.18.0 — the spec/decompose helpers are no longer
 * slash commands; the unified `/sprint-plan` wrapper handles both via
 * `--phase`):
 *   --phase spec       → claude /sprint-plan --phase spec <EPIC_ID>
 *   --phase decompose  → claude /sprint-plan --phase decompose <EPIC_ID>
 *   --phase execute    → claude /sprint-execute <EPIC_ID>   (default)
 *
 * Required env:
 *   EPIC_ID           — Epic issue number to plan / orchestrate.
 *   GITHUB_TOKEN      — token used for the clone (injected as x-access-token).
 *
 * Optional env:
 *   ENV_FILE          — contents for `.env` (multi-line string). Skipped when
 *                       empty or unset; projects that do not ship a `.env`
 *                       can omit the secret entirely.
 *   PHASE             — alias for `--phase`. CLI flag wins when both are set.
 *   REPO_URL          — HTTPS clone URL. Defaults to
 *                       `https://github.com/${GITHUB_REPOSITORY}.git`.
 *   WORKSPACE_DIR     — target directory for the clone (default: `./workspace`).
 *   REPO_REF          — branch/ref to check out (default: `main`).
 *   CLAUDE_BIN        — path to the `claude` CLI (default: `claude`).
 *   SKIP_LAUNCH       — when truthy, skip the final `claude` exec. Useful for
 *                       integration tests of the bootstrap itself.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Factored to a module constant so the escomplex-based maintainability
// parser doesn't choke on a regex literal passed inline to `.split()`.
const LINE_SPLIT = /\r?\n/;

/**
 * Map a phase slug to the slash command the remote agent should invoke.
 * Exported so tests and callers share a single source of truth.
 */
export const PHASE_TO_COMMAND = Object.freeze({
  spec: '/sprint-plan --phase spec',
  decompose: '/sprint-plan --phase decompose',
  execute: '/sprint-execute',
});

/**
 * Parse a `--phase <value>` / `--phase=value` pair from an argv slice.
 * Returns `undefined` when the flag is not present. Throws when the flag
 * is supplied without a value.
 */
export function parsePhaseFromArgv(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--phase') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--phase requires a value (spec|decompose|execute)');
      }
      return value;
    }
    if (arg.startsWith('--phase=')) {
      return arg.slice('--phase='.length);
    }
  }
  return undefined;
}

/**
 * Resolve the phase from CLI args (preferred) or env fallback. Defaults to
 * `execute` so v5.14.0 call sites without `--phase` continue to work.
 */
export function resolvePhase({ argv = [], env = {} } = {}) {
  const fromArgv = parsePhaseFromArgv(argv);
  const raw = (fromArgv ?? env.PHASE ?? 'execute').trim().toLowerCase();
  if (!Object.hasOwn(PHASE_TO_COMMAND, raw)) {
    const valid = Object.keys(PHASE_TO_COMMAND).join('|');
    throw new Error(`Unknown --phase "${raw}" (expected one of: ${valid})`);
  }
  return raw;
}

function log(msg) {
  console.log(`[remote-bootstrap] ${msg}`);
}

function fatal(msg) {
  console.error(`[remote-bootstrap] ERROR: ${msg}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    fatal(`Missing required env var: ${name}`);
  }
  return value;
}

function maskSecret(value) {
  // Emit ::add-mask:: per non-empty line so GitHub Actions redacts any
  // accidental echo. Safe to call even outside Actions — consumers just
  // see the directive in stdout.
  for (const line of value.split(LINE_SPLIT)) {
    const trimmed = line.trim();
    if (trimmed) {
      console.log(`::add-mask::${trimmed}`);
    }
  }
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    fatal(`${cmd} exited with status ${result.status}`);
  }
}

function writeSecretFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: 0o600 });
}

/**
 * Pure: resolve the workspace clone target (URL, ref, workspace dir) from env.
 * Returns `{ ok: false, reason }` if neither REPO_URL nor GITHUB_REPOSITORY
 * is set; the CLI lifts that into a fatal call.
 */
export function resolveCloneTarget(env) {
  const repoSlug = env.GITHUB_REPOSITORY;
  const repoUrl =
    env.REPO_URL || (repoSlug ? `https://github.com/${repoSlug}.git` : null);
  if (!repoUrl) {
    return {
      ok: false,
      reason: 'REPO_URL or GITHUB_REPOSITORY must be set.',
    };
  }
  return {
    ok: true,
    repoUrl,
    workspace: resolve(env.WORKSPACE_DIR || 'workspace'),
    ref: env.REPO_REF || 'main',
  };
}

/** Pure: inject a GitHub token into an HTTPS clone URL. */
export function buildAuthenticatedCloneUrl(repoUrl, token) {
  return repoUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

/** Pure: build the launch argv for the chosen phase. */
export function buildLaunchInvocation({ phase, epicId, claudeBin = 'claude' }) {
  const command = PHASE_TO_COMMAND[phase];
  return {
    bin: claudeBin,
    args: [...command.split(' '), String(epicId)],
    command,
  };
}

async function main() {
  const epicId = requireEnv('EPIC_ID');
  const envFile = process.env.ENV_FILE ?? '';
  const githubToken = requireEnv('GITHUB_TOKEN');

  const target = resolveCloneTarget(process.env);
  if (!target.ok) fatal(target.reason);
  const { repoUrl, workspace, ref } = target;

  if (envFile) maskSecret(envFile);
  maskSecret(githubToken);

  const cloneUrl = buildAuthenticatedCloneUrl(repoUrl, githubToken);
  log(`Cloning ${repoUrl} @ ${ref} → ${workspace}`);
  run('git', ['clone', '--depth=1', '--branch', ref, cloneUrl, workspace]);

  if (envFile) {
    writeSecretFile(resolve(workspace, '.env'), envFile);
    log('Provisioned .env (mode 0600).');
  } else {
    log('No ENV_FILE secret supplied — skipping .env.');
  }

  run('npm', ['ci', '--ignore-scripts'], { cwd: workspace });

  if (process.env.SKIP_LAUNCH) {
    log('SKIP_LAUNCH set — bootstrap complete, not launching claude.');
    return;
  }
  const phase = resolvePhase({
    argv: process.argv.slice(2),
    env: process.env,
  });
  const launch = buildLaunchInvocation({
    phase,
    epicId,
    claudeBin: process.env.CLAUDE_BIN,
  });
  log(`Launching ${launch.bin} ${launch.command} ${epicId} (phase=${phase})`);
  run(launch.bin, launch.args, { cwd: workspace });
}

// cli-opt-out: bespoke fatal() helper (not Logger) is shared with sub-helpers in this module; runAsCli would force the default error formatter.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    fatal(err?.stack || String(err));
  });
}
