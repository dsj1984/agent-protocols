/**
 * diagnose-friction.js — v5 Diagnostic Interceptor & Ticket Comment Logger
 *
 * Wraps a shell command with telemetry capture. On failure:
 *   1. Prints static diagnostic suggestions to stdout.
 *   2. Posts a structured `friction` comment to the Task ticket via
 *      update-ticket-state.js (if --task is provided).
 *
 * In v5, GitHub is the SSOT — no local friction log files are written.
 * All friction events are persisted to the ticket graph.
 *
 * Usage:
 *   node diagnose-friction.js [--task <TASK_ID>] --cmd <command with args...>
 *
 * @see docs/v5-implementation-plan.md Sprint 3E
 */

import { spawnSync } from 'node:child_process';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { postStructuredComment } from './update-ticket-state.js';

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let taskId = null;
let cmdArgs = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--task') {
    taskId = args[++i] || null;
  } else if (args[i] === '--cmd') {
    cmdArgs = args.slice(i + 1);
    break;
  }
}

if (cmdArgs.length === 0) {
  Logger.fatal(
    'Usage: node diagnose-friction.js [--task <TASK_ID>] --cmd <command with args...>',
  );
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const { settings } = resolveConfig();
const executionTimeoutMs = settings.executionTimeoutMs ?? 300000;
const executionMaxBuffer = settings.executionMaxBuffer ?? 10485760;

// ---------------------------------------------------------------------------
// Execute the wrapped command
// ---------------------------------------------------------------------------

const commandStr = cmdArgs.join(' ');
console.log(`[Diagnostic Interceptor] Executing: ${commandStr}`);

const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
  stdio: 'pipe',
  shell: true,
  encoding: 'utf-8',
  timeout: executionTimeoutMs,
  maxBuffer: executionMaxBuffer,
});

// Mirror output so the agent can see it
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  const errorOutput = (
    result.stderr ||
    result.stdout ||
    `Unknown exit code ${result.status}`
  ).trim();
  const errorPreview = errorOutput.substring(0, 500);

  console.log('\n--- 🛑 DIAGNOSTIC ANALYSIS Triggered ---');
  console.log('Command failed. Logging friction to GitHub ticket...');

  // Post a structured friction comment to the Task ticket (v5 SSOT)
  if (taskId) {
    try {
      await postStructuredComment(
        parseInt(taskId, 10),
        'friction',
        `Command failed: \`${commandStr}\`\n\nExit code: ${result.status}\n\n\`\`\`\n${errorPreview}\n\`\`\``,
      );
      console.log(`✅ Friction posted to Task #${taskId} on GitHub.`);
    } catch (err) {
      console.error(
        `⚠️ Failed to post friction comment to Task #${taskId}: ${err.message}`,
      );
      // Non-fatal — the exit code is the primary signal
    }
  } else {
    console.log('ℹ️ No --task provided; skipping GitHub friction comment.');
  }

  // Static auto-remediation suggestions
  console.log('\n💡 [Auto-Remediation Suggestions]:');
  if (
    errorOutput.includes('EADDRINUSE') ||
    errorOutput.includes('address already in use')
  ) {
    console.log(' - Port collision detected. Try: `npx kill-port <PORT>`.');
  } else if (
    errorOutput.includes('Cannot find module') ||
    errorOutput.includes('TS2307')
  ) {
    console.log(
      ' - Missing dependency or bad import path. Ensure you are in the correct workspace root and have run `npm install`.',
    );
  } else if (errorOutput.includes('SyntaxError')) {
    console.log(
      ' - Syntax/parsing error. Check recently modified files for missing brackets, quotes, or invalid structures.',
    );
  } else if (errorOutput.includes('Astro') || errorOutput.includes('astro')) {
    console.log(
      ' - Framework error: Refer to `.agents/skills/stack/frontend/astro/SKILL.md` for Astro rules.',
    );
  } else {
    console.log(
      ' - Generic failure. Review stderr above, refine your approach, or check `.agents/instructions.md`.',
    );
  }
  console.log('----------------------------------------\n');

  process.exit(result.status);
} else {
  process.exit(0);
}
