/**
 * verify-prereqs.js — v5 Ticket-State Prerequisite Checker
 *
 * Verifies that all prerequisite Tasks for a given Task ticket are in the
 * `agent::done` state in GitHub before dispatching the target Task. This
 * replaces the legacy playbook-based checker that parsed local markdown files.
 *
 * In v5, GitHub is the Single Source of Truth. All blocking dependency
 * detection is performed via the ticketing provider.
 *
 * Usage:
 *   node verify-prereqs.js --task <TASK_ID> [--epic <EPIC_ID>]
 *
 * Exit codes:
 *   0 — All prerequisites satisfied.
 *   1 — One or more prerequisites are not yet agent::done.
 *
 * @see docs/v5-implementation-plan.md Sprint 3E
 */

import { resolveConfig } from './lib/config-resolver.js';
import { parseBlockedBy } from './lib/dependency-parser.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  let taskId = null;
  let _epicId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task') {
      taskId = args[++i];
    } else if (args[i] === '--epic') {
      _epicId = args[++i];
    }
  }

  if (!taskId) {
    Logger.fatal(
      'Usage: node verify-prereqs.js --task <TASK_ID> [--epic <EPIC_ID>]',
    );
  }

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);
  const AGENT_DONE_LABEL = 'agent::done';
  console.log(`[verify-prereqs] Checking prerequisites for Task #${taskId}...`);

  // Fetch the target task ticket
  let task;
  try {
    task = await provider.getTicket(parseInt(taskId, 10));
  } catch (err) {
    Logger.fatal(`Failed to fetch Task #${taskId}: ${err.message}`);
  }

  // Parse blocked-by dependencies from ticket body
  const blockedBy = parseBlockedBy(task.body ?? '');

  if (blockedBy.length === 0) {
    console.log(
      `[verify-prereqs] ✅ Task #${taskId} has no dependencies. Ready to dispatch.`,
    );
    process.exit(0);
  }

  console.log(
    `[verify-prereqs] Found ${blockedBy.length} dependency/dependencies: ${blockedBy.map((id) => `#${id}`).join(', ')}`,
  );

  let hasFailedDeps = false;

  for (const depId of blockedBy) {
    let dep;
    try {
      dep = await provider.getTicket(depId);
    } catch (err) {
      console.error(
        `[verify-prereqs] ❌ ERROR: Could not fetch dependency #${depId}: ${err.message}`,
      );
      hasFailedDeps = true;
      continue;
    }

    const isDone = (dep.labels ?? []).includes(AGENT_DONE_LABEL);

    if (isDone) {
      console.log(
        `[verify-prereqs] ✅ Prerequisite #${depId} (${dep.title}) is agent::done.`,
      );
    } else {
      const currentState =
        (dep.labels ?? []).find((l) => l.startsWith('agent::')) ??
        'no agent:: label';
      console.error(
        `[verify-prereqs] ❌ ERROR: Prerequisite #${depId} (${dep.title}) is NOT done. ` +
          `Current state: ${currentState}`,
      );
      hasFailedDeps = true;
    }
  }

  if (hasFailedDeps) {
    Logger.fatal(
      `\n❌ VERIFICATION FAILED: Task #${taskId} is blocked by incomplete prerequisites.\n` +
        'Resolve the above dependencies before dispatching this task.',
    );
  } else {
    console.log(
      `\n✅ VERIFICATION PASSED: All prerequisites for Task #${taskId} are agent::done.`,
    );
    process.exit(0);
  }
}

main().catch((err) => {
  Logger.fatal(`verify-prereqs: Unexpected error — ${err.message}`);
});
