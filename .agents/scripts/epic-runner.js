#!/usr/bin/env node
/* node:coverage ignore file */
/**
 * Epic Runner — thin CLI wrapper around `lib/orchestration/epic-runner.js`.
 *
 * Scaffolded by Story #331. The engine it wraps is added in a follow-up Story
 * (see tech spec #323, Core Components → `lib/orchestration/epic-runner.js`).
 * Until the engine lands, this CLI exits with a clear `not-yet-implemented`
 * message rather than silently no-op'ing — making the dependency explicit for
 * anyone wiring `/sprint-execute` (Epic Mode) before the engine merge.
 *
 * Usage:
 *   node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]
 */

import { execSync, spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import { runAsCli } from './lib/cli-utils.js';
import { AGENT_LABELS } from './lib/label-constants.js';
import { buildClaudeSpawn } from './lib/orchestration/epic-runner/build-claude-spawn.js';

const DEFAULT_LOGS_DIR = 'temp/epic-runner-logs';
const DEFAULT_IDLE_TIMEOUT_SEC = 900;
const IDLE_GRACE_MS = 120_000;
const IDLE_GRACE_POLL_MS = 15_000;

/**
 * Kill a spawned child and — on Windows — its entire process tree.
 *
 * On Windows we launch `claude` via `cmd.exe` shell (see build-claude-spawn.js),
 * so `proc.kill()` only terminates the shell and orphans the real work
 * (node.exe running Claude Code as a grandchild). taskkill /T kills the tree.
 */
function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  if (process.platform === 'win32' && proc.pid) {
    try {
      execSync(`taskkill /T /F /PID ${proc.pid}`, {
        stdio: 'ignore',
        timeout: 5000,
      });
      return;
    } catch {
      /* best effort — fall through to proc.kill() */
    }
  }
  try {
    proc.kill();
  } catch {
    /* already exited */
  }
}

/**
 * Read a Story's current ticket state. Returns the status the epic runner
 * cares about (done / blocked / pending) plus the raw label list so callers
 * can include it in friction details.
 */
async function readStoryOutcome(storyId) {
  const { resolveConfig } = await import('./lib/config-resolver.js');
  const { createProvider } = await import('./lib/provider-factory.js');
  const provider = createProvider(resolveConfig().orchestration);
  const story = await provider.getTicket(storyId, { fresh: true });
  const labels = story?.labels ?? [];
  if (labels.includes(AGENT_LABELS.DONE)) return { status: 'done', labels };
  if (labels.includes(AGENT_LABELS.BLOCKED))
    return { status: 'blocked', labels };
  return { status: 'pending', labels };
}

/**
 * Poll a Story's ticket state for up to `graceMs` ms, resolving as soon as
 * the ticket reaches a terminal state (done or blocked). Used after the idle
 * watchdog fires to absorb the "Windows shell-spawn orphan finishes after we
 * kill the shell" race — the real work may complete within the grace window
 * even though the pipe went silent.
 */
async function pollStoryOutcome(
  storyId,
  graceMs = IDLE_GRACE_MS,
  intervalMs = IDLE_GRACE_POLL_MS,
) {
  const deadline = Date.now() + graceMs;
  let last = { status: 'pending', labels: [] };
  while (true) {
    try {
      last = await readStoryOutcome(storyId);
    } catch (err) {
      last = { status: 'pending', labels: [], error: err.message };
    }
    if (last.status === 'done' || last.status === 'blocked') return last;
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function resolveLogsDir(epicRunnerCfg) {
  return epicRunnerCfg?.logsDir || DEFAULT_LOGS_DIR;
}

function resolveIdleTimeoutMs(epicRunnerCfg) {
  const sec = Number(epicRunnerCfg?.idleTimeoutSec ?? DEFAULT_IDLE_TIMEOUT_SEC);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
}

function parseArgs(argv) {
  const args = { epicId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--epic') {
      args.epicId = Number(argv[++i]);
    } else if (flag === '--dry-run') {
      args.dryRun = true;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.epicId || Number.isNaN(args.epicId)) {
    console.error('[epic-runner] ERROR: --epic <epicId> is required.');
    printUsage();
    process.exit(2);
  }

  const { runEpic } = await import('./lib/orchestration/epic-runner.js');
  const { getRunners, resolveConfig, validateOrchestrationConfig } =
    await import('./lib/config-resolver.js');
  const { createProvider } = await import('./lib/provider-factory.js');

  let config;
  try {
    config = resolveConfig();
    validateOrchestrationConfig(config.orchestration);
  } catch (err) {
    console.error(
      `[epic-runner] ERROR: orchestration config schema validation failed:\n${err.message}`,
    );
    process.exit(2);
  }

  if (!config.orchestration) {
    console.error(
      '[epic-runner] ERROR: no orchestration block in .agentrc.json.',
    );
    process.exit(1);
  }

  const provider = createProvider(config.orchestration);

  const { epicRunner } = getRunners(config.orchestration);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          epicId: args.epicId,
          dryRun: true,
          epicRunner,
        },
        null,
        2,
      ),
    );
    return;
  }

  const logsDir = resolveLogsDir(epicRunner);
  const idleTimeoutMs = resolveIdleTimeoutMs(epicRunner);
  const result = await runEpic({
    epicId: args.epicId,
    provider,
    config: config.orchestration,
    autoVersionBump: Boolean(config.settings?.release?.autoVersionBump),
    spawn: (spawnArgs) =>
      defaultSpawn({ ...spawnArgs, logsDir, idleTimeoutMs }),
    runSkill: (skill, runArgs) =>
      defaultRunSkill(skill, { ...runArgs, logsDir, idleTimeoutMs }),
  });

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Default spawn adapter — spawns a fresh Claude Code subprocess per story
 * that drives `/sprint-execute <storyId>` end-to-end (init → implement →
 * validate → close). Each story is executed by a separate agent instance,
 * so concurrencyCap translates directly into parallel Claude sessions.
 *
 * Success criterion is not the subprocess exit code — Claude may exit 0 even
 * if the Story Mode workflow bailed. We verify by reading the Story's labels
 * after exit: `agent::done` = success, `agent::blocked` = blocker, anything
 * else = failure. Per-story stdout/stderr is piped to
 * `<logsDir>/story-<id>.log` (default `temp/epic-runner-logs/`, configurable
 * via `orchestration.runners.epicRunner.logsDir`) to keep parallel runs readable.
 */
async function defaultSpawn({
  storyId,
  signal,
  logsDir = DEFAULT_LOGS_DIR,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_SEC * 1000,
}) {
  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `story-${storyId}.log`);
  const logHandle = await open(logPath, 'w');

  return new Promise((resolve) => {
    const launch = buildClaudeSpawn(
      ['-p', `/sprint-execute ${storyId}`, '--dangerously-skip-permissions'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const proc = spawn(launch.file, launch.args, launch.options);

    const watchdog = attachIdleWatchdog(proc, logHandle, idleTimeoutMs);

    const onAbort = () => killProcessTree(proc);
    signal?.addEventListener?.('abort', onAbort, { once: true });

    proc.on('error', (err) => {
      signal?.removeEventListener?.('abort', onAbort);
      watchdog.stop();
      logHandle.close().catch((closeErr) => {
        console.warn(
          `[epic-runner] story log close failed for #${storyId}: ${closeErr?.message ?? closeErr}`,
        );
      });
      resolve({ status: 'failed', detail: err.message });
    });

    proc.on('exit', async (code) => {
      signal?.removeEventListener?.('abort', onAbort);
      watchdog.stop();
      await logHandle.close().catch((closeErr) => {
        console.warn(
          `[epic-runner] story log close failed for #${storyId}: ${closeErr?.message ?? closeErr}`,
        );
      });
      if (watchdog.idleTimedOut) {
        // `claude -p` runs in batch mode — it emits no stdout until the model
        // finishes, so long stories can legitimately go >idleTimeoutSec with
        // zero output. Combined with the Windows shell-spawn orphan (the real
        // work may survive proc.kill() on cmd.exe), the pipe-silence signal
        // is not authoritative. Poll the Story's ticket state for a grace
        // window — if the orphan finishes the merge+close, we report the
        // truth (done) instead of a false failure.
        const outcome = await pollStoryOutcome(storyId);
        if (outcome.status === 'done') return resolve({ status: 'done' });
        if (outcome.status === 'blocked') {
          return resolve({
            status: 'blocked',
            detail: `${AGENT_LABELS.BLOCKED} (after idle-timeout grace); see ${logPath}`,
          });
        }
        return resolve({
          status: 'failed',
          detail: `idle-timeout: no output for ${Math.round(idleTimeoutMs / 1000)}s; labels=${outcome.labels.join('|') || 'none'}; see ${logPath}`,
        });
      }
      if (code !== 0) {
        return resolve({
          status: 'failed',
          detail: `claude exited ${code}; see ${logPath}`,
        });
      }
      try {
        const outcome = await readStoryOutcome(storyId);
        if (outcome.status === 'done') return resolve({ status: 'done' });
        if (outcome.status === 'blocked') {
          return resolve({
            status: 'blocked',
            detail: `${AGENT_LABELS.BLOCKED}; see ${logPath}`,
          });
        }
        resolve({
          status: 'failed',
          detail: `story not closed (labels: ${outcome.labels.join(', ')}); see ${logPath}`,
        });
      } catch (err) {
        resolve({
          status: 'failed',
          detail: `post-run label check failed: ${err.message}`,
        });
      }
    });
  });
}

/**
 * Default runSkill adapter — drives `/sprint-close <epicId>` in a fresh
 * Claude Code subprocess when `epic::auto-close` was snapshotted at dispatch
 * time. Review + retro are intentionally excluded (see BookendChainer): this
 * adapter only exposes the single autonomous action the operator authorized.
 *
 * Stdout/stderr are piped to `<logsDir>/bookend-<skill>.log` (default
 * `temp/epic-runner-logs/`, configurable via
 * `orchestration.runners.epicRunner.logsDir`) to keep the parent runner's stream
 * readable. The subprocess exit code is the sole success signal.
 */
async function defaultRunSkill(
  skill,
  {
    epicId,
    logsDir = DEFAULT_LOGS_DIR,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_SEC * 1000,
  },
) {
  if (skill !== '/sprint-close') {
    return {
      status: 'failed',
      detail: `defaultRunSkill refused to invoke ${skill}; only /sprint-close is auto-dispatched`,
    };
  }

  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `bookend-sprint-close-${epicId}.log`);
  const logHandle = await open(logPath, 'w');

  return new Promise((resolve) => {
    const launch = buildClaudeSpawn(
      ['-p', `${skill} ${epicId}`, '--dangerously-skip-permissions'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const proc = spawn(launch.file, launch.args, launch.options);
    const watchdog = attachIdleWatchdog(proc, logHandle, idleTimeoutMs);
    proc.on('error', (err) => {
      watchdog.stop();
      logHandle.close().catch((closeErr) => {
        console.warn(
          `[epic-runner] sprint-close bookend log close failed for epic #${epicId}: ${closeErr?.message ?? closeErr}`,
        );
      });
      resolve({ status: 'failed', detail: err.message });
    });
    proc.on('exit', async (code) => {
      watchdog.stop();
      await logHandle.close().catch((closeErr) => {
        console.warn(
          `[epic-runner] sprint-close bookend log close failed for epic #${epicId}: ${closeErr?.message ?? closeErr}`,
        );
      });
      if (watchdog.idleTimedOut) {
        return resolve({
          status: 'failed',
          detail: `idle-timeout: no output for ${Math.round(idleTimeoutMs / 1000)}s (likely hung on interactive prompt); see ${logPath}`,
        });
      }
      if (code === 0) return resolve({ status: 'ok' });
      resolve({
        status: 'failed',
        detail: `claude exited ${code}; see ${logPath}`,
      });
    });
  });
}

/**
 * Attaches an idle-output watchdog to a spawned Claude subprocess. Each chunk
 * on stdout/stderr is written to `logHandle` and resets the idle timer. If no
 * output arrives within `idleMs`, the child is killed and `idleTimedOut` is
 * set so the caller can distinguish this from a normal non-zero exit.
 *
 * `idleMs <= 0` disables the watchdog (output is still teed to the log).
 */
function attachIdleWatchdog(proc, logHandle, idleMs) {
  const state = { idleTimedOut: false, timer: null, stopped: false };

  const writeChunk = (chunk) => {
    logHandle.write(chunk).catch((writeErr) => {
      console.warn(
        `[epic-runner] log write failed: ${writeErr?.message ?? writeErr}`,
      );
    });
    resetTimer();
  };

  const resetTimer = () => {
    if (state.stopped || !(idleMs > 0)) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.idleTimedOut = true;
      killProcessTree(proc);
    }, idleMs);
  };

  proc.stdout?.on('data', writeChunk);
  proc.stderr?.on('data', writeChunk);
  resetTimer();

  return {
    get idleTimedOut() {
      return state.idleTimedOut;
    },
    stop() {
      state.stopped = true;
      if (state.timer) clearTimeout(state.timer);
    },
  };
}

runAsCli(import.meta.url, main, { source: 'EpicRunner' });
