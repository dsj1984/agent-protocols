/* node:coverage ignore file */
/**
 * Bootstrap Agent Protocols — Idempotent Label & Field Setup
 *
 * Creates the required label taxonomy and project board custom fields
 * for the v5 Epic-centric orchestration. Idempotent — skips resources
 * that already exist.
 *
 * Usage:
 *   node .agents/scripts/bootstrap-agent-protocols.js
 *
 * Reads orchestration config from .agentrc.json via the config resolver,
 * then uses the provider factory to instantiate the correct provider.
 *
 * @see docs/v5-implementation-plan.md Sprint 1C
 */

import { runAsCli } from './lib/cli-utils.js';
import { Logger } from './lib/Logger.js';
import {
  LABEL_TAXONOMY,
  PROJECT_FIELD_DEFS,
  PROJECT_VIEW_DEFS,
  STATUS_FIELD_OPTIONS,
} from './lib/label-taxonomy.js';
import { createProvider } from './lib/provider-factory.js';

// ---------------------------------------------------------------------------
// Bootstrap Runner
// ---------------------------------------------------------------------------

/**
 * Run the idempotent bootstrap sequence.
 *
 * @param {object} orchestration - The orchestration config from .agentrc.json.
 * @param {{ token?: string, quiet?: boolean }} [opts]
 * @returns {Promise<{
 *   labels: { created: string[], skipped: string[] },
 *   fields: { created: string[], skipped: string[] },
 *   project: { projectNumber: number|null, created: boolean, skipped: boolean, scopesMissing: boolean },
 *   statusField: { status: string, added: string[] },
 *   views: { created: string[], skipped: string[], unavailable: boolean },
 * }>}
 */
export async function runBootstrap(orchestration, opts = {}) {
  const provider =
    opts.providerOverride ??
    createProvider(orchestration, { token: opts.token });
  const log = opts.quiet ? () => {} : console.log;

  log('[bootstrap] Starting idempotent setup...');
  log(`[bootstrap] Provider: ${orchestration.provider}`);
  log(
    `[bootstrap] Target: ${orchestration[orchestration.provider]?.owner}/${orchestration[orchestration.provider]?.repo}`,
  );

  // Step 1: Verify API access
  log('[bootstrap] Verifying API access...');
  try {
    await provider.getTicket(1);
  } catch (err) {
    // A 404 is fine — it means the API is reachable but issue #1 doesn't exist.
    // Any other error indicates a real problem.
    if (!err.message.includes('404')) {
      throw new Error(
        `[bootstrap] API access verification failed: ${err.message}`,
      );
    }
  }
  log('[bootstrap] API access verified.');

  // Step 2: Create labels
  log(`[bootstrap] Ensuring ${LABEL_TAXONOMY.length} labels...`);
  const labels = await provider.ensureLabels(LABEL_TAXONOMY);
  log(
    `[bootstrap] Labels — created: ${labels.created.length}, skipped: ${labels.skipped.length}`,
  );
  if (labels.created.length > 0) {
    log(`[bootstrap]   Created: ${labels.created.join(', ')}`);
  }

  // Step 3: Resolve or create the Projects V2 board.
  let fields = { created: [], skipped: [] };
  let project = {
    projectNumber: null,
    created: false,
    skipped: true,
    scopesMissing: false,
  };
  let statusField = { status: 'skipped', added: [] };
  let views = { created: [], skipped: [], unavailable: false };
  const providerConfig = orchestration[orchestration.provider];
  const projectsDocPointer =
    'See docs/project-board.md for the manual Projects V2 setup checklist.';

  try {
    const projectResult = await provider.resolveOrCreateProject();
    if (projectResult.scopesMissing) {
      project = {
        projectNumber: providerConfig?.projectNumber ?? null,
        created: false,
        skipped: true,
        scopesMissing: true,
      };
      log(
        `[bootstrap] Projects V2: token lacks the "project" scope — skipping board provisioning. ${projectsDocPointer}`,
      );
    } else {
      project = {
        projectNumber: projectResult.projectNumber ?? null,
        created: !!projectResult.created,
        skipped: false,
        scopesMissing: false,
      };
      if (projectResult.created) {
        log(`[bootstrap] Created Project V2 #${project.projectNumber}.`);
      } else {
        log(`[bootstrap] Using Project V2 #${project.projectNumber}.`);
      }
    }
  } catch (err) {
    project = {
      projectNumber: providerConfig?.projectNumber ?? null,
      created: false,
      skipped: true,
      scopesMissing: false,
    };
    log(
      `[bootstrap] Projects V2 resolution failed: ${err.message}. ${projectsDocPointer}`,
    );
  }

  // Step 4: Ensure the Status single-select field (8 lifecycle options).
  if (!project.skipped && project.projectNumber) {
    try {
      statusField = await provider.ensureStatusField(STATUS_FIELD_OPTIONS);
      if (statusField.status === 'scopes-missing') {
        log(
          `[bootstrap] Projects V2 Status field: insufficient scopes. ${projectsDocPointer}`,
        );
      } else {
        log(
          `[bootstrap] Status field — ${statusField.status}` +
            (statusField.added.length
              ? ` (added: ${statusField.added.join(', ')})`
              : ''),
        );
      }
    } catch (err) {
      log(`[bootstrap] Status field provisioning failed: ${err.message}`);
    }
  }

  // Step 5: Attempt Views creation (best-effort).
  if (!project.skipped && project.projectNumber) {
    try {
      views = await provider.ensureProjectViews(PROJECT_VIEW_DEFS);
      if (views.unavailable) {
        log(
          `[bootstrap] Projects V2 Views mutation unavailable — skipped ${views.skipped.join(', ')}. ${projectsDocPointer}`,
        );
      } else {
        log(
          `[bootstrap] Views — created: ${views.created.length}, skipped: ${views.skipped.length}`,
        );
      }
    } catch (err) {
      log(`[bootstrap] Views provisioning failed: ${err.message}`);
    }
  }

  // Step 6: Ensure legacy custom fields (Sprint, Execution).
  if (!project.skipped && project.projectNumber) {
    log(
      `[bootstrap] Ensuring ${PROJECT_FIELD_DEFS.length} project fields on project #${project.projectNumber}...`,
    );
    fields = await provider.ensureProjectFields(PROJECT_FIELD_DEFS);
    log(
      `[bootstrap] Fields — created: ${fields.created.length}, skipped: ${fields.skipped.length}`,
    );
  } else {
    log('[bootstrap] No active project — skipping legacy project-field setup.');
  }

  log('[bootstrap] Done.');

  return { labels, fields, project, statusField, views };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  // Dynamic import to avoid circular dependency issues at module level
  const { resolveConfig, validateOrchestrationConfig } = await import(
    './lib/config-resolver.js'
  );

  const config = resolveConfig();

  if (!config.orchestration) {
    console.error(
      '[bootstrap] ERROR: No "orchestration" block found in .agentrc.json.',
    );
    Logger.fatal();
  }

  try {
    validateOrchestrationConfig(config.orchestration);
  } catch (err) {
    console.error(`[bootstrap] ERROR: ${err.message}`);
    process.exit(1);
  }

  const installWorkflows = process.argv.includes('--install-workflows');

  try {
    const result = await runBootstrap(config.orchestration, {
      installWorkflows,
    });

    console.log('\n=== Bootstrap Summary ===');
    console.log(`Labels created: ${result.labels.created.length}`);
    console.log(`Labels skipped: ${result.labels.skipped.length}`);
    console.log(`Fields created: ${result.fields.created.length}`);
    console.log(`Fields skipped: ${result.fields.skipped.length}`);
    console.log(
      `Project: ${
        result.project.scopesMissing
          ? 'skipped (missing project scope)'
          : result.project.created
            ? `created #${result.project.projectNumber}`
            : result.project.projectNumber
              ? `adopted #${result.project.projectNumber}`
              : 'skipped'
      }`,
    );
    console.log(`Status field: ${result.statusField.status}`);
    console.log(
      `Views — created: ${result.views.created.length}, skipped: ${result.views.skipped.length}${
        result.views.unavailable ? ' (mutation unavailable)' : ''
      }`,
    );
  } catch (_err) {
    Logger.fatal();
  }
}

runAsCli(import.meta.url, main, { source: 'Bootstrap' });
