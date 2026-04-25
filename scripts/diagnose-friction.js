#!/usr/bin/env node
/* node:coverage ignore file */

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
import crypto from 'node:crypto';
import { getLimits, resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { postStructuredComment } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArguments(args) {
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
  return { taskId, cmdArgs };
}

function classifyFrictionCategory(errorOutput) {
  if (
    errorOutput.includes('EADDRINUSE') ||
    errorOutput.includes('address already in use')
  ) {
    return {
      category: 'Tool Limitation',
      remediation: ' - Port collision detected. Try: `npx kill-port <PORT>`.',
    };
  }
  if (
    errorOutput.includes('Cannot find module') ||
    errorOutput.includes('TS2307')
  ) {
    return {
      category: 'Missing Skill',
      remediation:
        ' - Missing dependency or bad import path. Ensure you are in the correct workspace root and have run `npm install`.',
    };
  }
  if (errorOutput.includes('SyntaxError')) {
    return {
      category: 'Execution Error',
      remediation:
        ' - Syntax/parsing error. Check recently modified files for missing brackets, quotes, or invalid structures.',
    };
  }
  if (errorOutput.includes('Astro') || errorOutput.includes('astro')) {
    return {
      category: 'Missing Skill',
      remediation:
        ' - Framework error: Refer to `.agents/skills/stack/frontend/astro/SKILL.md` for Astro rules.',
    };
  }
  return {
    category: 'Execution Error',
    remediation:
      ' - Generic failure. Review stderr above, refine your approach, or check `.agents/instructions.md`.',
  };
}

async function resolveSprintId(provider, taskId, settings) {
  let resolvedSprintId = process.env.SPRINT_ID || settings.epicId || 'unknown';
  if (resolvedSprintId === 'unknown' && taskId && !process.env.NO_NETWORK) {
    try {
      const ticket = await provider.getTicket(taskId);
      const epicMatch = ticket.body?.match(/(?:Epic|parent):\s*#(\d+)/i);
      if (epicMatch) {
        resolvedSprintId = epicMatch[1];
      }
    } catch (err) {
      console.error(
        `⚠️ Failed to dynamically resolve Sprint ID: ${err.message}`,
      );
    }
  }
  return resolvedSprintId;
}

function buildFrictionEvent(
  resolvedSprintId,
  taskId,
  category,
  commandStr,
  errorPreview,
) {
  return {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sprintId: resolvedSprintId,
    taskId: taskId ? Number.parseInt(taskId, 10) : null,
    category,
    source: {
      tool: 'diagnose-friction.js',
      command: commandStr,
    },
    details: errorPreview,
  };
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

export async function main(args = process.argv.slice(2)) {
  const { taskId, cmdArgs } = parseArguments(args);

  if (cmdArgs.length === 0) {
    Logger.fatal(
      'Usage: node diagnose-friction.js [--task <TASK_ID>] --cmd <command with args...>',
    );
  }

  const { settings } = resolveConfig();
  const limits = getLimits({ agentSettings: settings });
  const executionTimeoutMs = limits.executionTimeoutMs;
  const executionMaxBuffer = limits.executionMaxBuffer;

  const commandStr = cmdArgs.join(' ');
  console.error(`[Diagnostic Interceptor] Executing: ${commandStr}`);

  const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
    stdio: 'pipe',
    encoding: 'utf-8',
    timeout: executionTimeoutMs,
    maxBuffer: executionMaxBuffer,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const errorOutput = (
      result.stderr ||
      result.stdout ||
      `Unknown exit code ${result.status}`
    ).trim();
    const errorPreview = errorOutput.substring(0, 500);

    console.error('\n--- 🛑 DIAGNOSTIC ANALYSIS Triggered ---');
    console.error('Command failed. Logging friction to GitHub ticket...');

    const { category, remediation } = classifyFrictionCategory(errorOutput);

    const provider = createProvider(resolveConfig().orchestration);
    const resolvedSprintId = await resolveSprintId(provider, taskId, settings);

    const frictionEvent = buildFrictionEvent(
      resolvedSprintId,
      taskId,
      category,
      commandStr,
      errorPreview,
    );

    if (taskId) {
      try {
        const payloadString = `\`\`\`json\n${JSON.stringify(frictionEvent, null, 2)}\n\`\`\``;
        await postStructuredComment(
          provider,
          Number.parseInt(taskId, 10),
          'friction',
          payloadString,
        );
        console.error(`✅ Friction posted to Task #${taskId} on GitHub.`);
      } catch (err) {
        console.error(
          `⚠️ Failed to post friction comment to Task #${taskId}: ${err.message}`,
        );
      }
    } else {
      console.error('ℹ️ No --task provided; skipping GitHub friction comment.');
    }

    console.error('\n💡 [Auto-Remediation Suggestions]:');
    console.error(remediation);
    console.error('----------------------------------------\n');

    process.exit(result.status);
  } else {
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Call main if run directly
// ---------------------------------------------------------------------------

import { runAsCli } from './lib/cli-utils.js';

runAsCli(import.meta.url, main, { source: 'DiagnoseFriction' });
