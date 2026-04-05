#!/usr/bin/env node

/**
 * run-agent-loop.js
 *
 * CLI entry point for the Perception-Action Event Stream.
 * All orchestration logic lives in lib/AgentLoopRunner.js —
 * this file only parses CLI arguments and starts the runner.
 *
 * Usage:
 *   node .agents/scripts/run-agent-loop.js <task-id> [--branch <branch>] [--pattern <pattern>]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoopRunner } from './lib/AgentLoopRunner.js';
import { Logger } from './lib/Logger.js';
import { VerboseLogger } from './lib/VerboseLogger.js';
import { resolveConfig } from './lib/config-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

let taskId = null;
let pattern = 'default';
let branch = null;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--pattern') {
    pattern = process.argv[++i];
  } else if (process.argv[i] === '--branch') {
    branch = process.argv[++i];
  } else if (!taskId) {
    taskId = process.argv[i];
  }
}

if (!taskId) {
  Logger.fatal('Usage: node run-agent-loop.js <task-id> [--branch <branch_name>] [--pattern <pattern_name>]');
}

// ---------------------------------------------------------------------------
// Bootstrap the runner
// ---------------------------------------------------------------------------

const { settings } = resolveConfig();
const streamDir = path.join(PROJECT_ROOT, settings.eventStreamsRoot || 'temp/event-streams');
const workspacesDir = path.join(PROJECT_ROOT, settings.workspacesRoot || 'temp/workspaces');
const executionTimeoutMs = settings.executionTimeoutMs;
const executionMaxBuffer = settings.executionMaxBuffer;

// Initialize verbose logging singleton (no-ops if disabled in config)
const verboseLogger = VerboseLogger.init(settings, PROJECT_ROOT, {
  taskId,
  source: 'run-agent-loop',
});

const runner = new AgentLoopRunner({ taskId, projectRoot: PROJECT_ROOT, branch, pattern, streamDir, workspacesDir, executionTimeoutMs, executionMaxBuffer, verboseLogger });
runner.start(process.stdin);
