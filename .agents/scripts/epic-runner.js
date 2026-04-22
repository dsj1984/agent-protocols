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

import { runAsCli } from './lib/cli-utils.js';
import { buildClaudeSpawn } from './lib/orchestration/epic-runner/build-claude-spawn.js';

const DEFAULT_LOGS_DIR = 'temp/epic-runner-logs';

function resolveLogsDir(epicRunnerCfg) {
  return epicRunnerCfg?.logsDir || DEFAULT_LOGS_DIR;
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
  const { resolveConfig, validateOrchestrationConfig } = await import(
    './lib/config-resolver.js'
  );
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

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          epicId: args.epicId,
          dryRun: true,
          epicRunner: config.orchestration.epicRunner,
        },
        null,
        2,
      ),
    );
    return;
  }

  const logsDir = resolveLogsDir(config.orchestration?.epicRunner);
  const result = await runEpic({
    epicId: args.epicId,
    provider,
    config: config.orchestration,
    spawn: (spawnArgs) => defaultSpawn({ ...spawnArgs, logsDir }),
    runSkill: (skill, runArgs) =>
      defaultRunSkill(skill, { ...runArgs, logsDir }),
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
 * via `orchestration.epicRunner.logsDir`) to keep parallel runs readable.
 */
async function defaultSpawn({ storyId, signal, logsDir = DEFAULT_LOGS_DIR }) {
  const { spawn } = await import('node:child_process');
  const { open, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `story-${storyId}.log`);
  const logHandle = await open(logPath, 'w');

  return new Promise((resolve) => {
    const launch = buildClaudeSpawn(
      ['-p', `/sprint-execute ${storyId}`, '--dangerously-skip-permissions'],
      { stdio: ['ignore', logHandle.fd, logHandle.fd] },
    );
    const proc = spawn(launch.file, launch.args, launch.options);

    const onAbort = () => proc.kill();
    signal?.addEventListener?.('abort', onAbort, { once: true });

    proc.on('error', (err) => {
      signal?.removeEventListener?.('abort', onAbort);
      logHandle.close().catch(() => {});
      resolve({ status: 'failed', detail: err.message });
    });

    proc.on('exit', async (code) => {
      signal?.removeEventListener?.('abort', onAbort);
      await logHandle.close().catch(() => {});
      if (code !== 0) {
        return resolve({
          status: 'failed',
          detail: `claude exited ${code}; see ${logPath}`,
        });
      }
      try {
        const { resolveConfig } = await import('./lib/config-resolver.js');
        const { createProvider } = await import('./lib/provider-factory.js');
        const provider = createProvider(resolveConfig().orchestration);
        const story = await provider.getTicket(storyId);
        const labels = story?.labels ?? [];
        if (labels.includes('agent::done')) return resolve({ status: 'done' });
        if (labels.includes('agent::blocked')) {
          return resolve({
            status: 'blocked',
            detail: `agent::blocked; see ${logPath}`,
          });
        }
        resolve({
          status: 'failed',
          detail: `story not closed (labels: ${labels.join(', ')}); see ${logPath}`,
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
 * `orchestration.epicRunner.logsDir`) to keep the parent runner's stream
 * readable. The subprocess exit code is the sole success signal.
 */
async function defaultRunSkill(skill, { epicId, logsDir = DEFAULT_LOGS_DIR }) {
  if (skill !== '/sprint-close') {
    return {
      status: 'failed',
      detail: `defaultRunSkill refused to invoke ${skill}; only /sprint-close is auto-dispatched`,
    };
  }
  const { spawn } = await import('node:child_process');
  const { open, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `bookend-sprint-close-${epicId}.log`);
  const logHandle = await open(logPath, 'w');

  return new Promise((resolve) => {
    const launch = buildClaudeSpawn(
      ['-p', `${skill} ${epicId}`, '--dangerously-skip-permissions'],
      { stdio: ['ignore', logHandle.fd, logHandle.fd] },
    );
    const proc = spawn(launch.file, launch.args, launch.options);
    proc.on('error', (err) => {
      logHandle.close().catch(() => {});
      resolve({ status: 'failed', detail: err.message });
    });
    proc.on('exit', async (code) => {
      await logHandle.close().catch(() => {});
      if (code === 0) return resolve({ status: 'ok' });
      resolve({
        status: 'failed',
        detail: `claude exited ${code}; see ${logPath}`,
      });
    });
  });
}

runAsCli(import.meta.url, main, { source: 'EpicRunner' });
