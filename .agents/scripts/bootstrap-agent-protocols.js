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

import fs from 'node:fs';
import path from 'node:path';
import { runAsCli } from './lib/cli-utils.js';
import { Logger } from './lib/Logger.js';
import { LABEL_TAXONOMY, PROJECT_FIELD_DEFS } from './lib/label-taxonomy.js';
import { createProvider } from './lib/provider-factory.js';

// ---------------------------------------------------------------------------
// Bootstrap Runner
// ---------------------------------------------------------------------------

/**
 * Run the idempotent bootstrap sequence.
 *
 * @param {object} orchestration - The orchestration config from .agentrc.json.
 * @param {{ token?: string, quiet?: boolean }} [opts]
 * @returns {Promise<{ labels: { created: string[], skipped: string[] }, fields: { created: string[], skipped: string[] } }>}
 */
export async function runBootstrap(orchestration, opts = {}) {
  const provider = createProvider(orchestration, { token: opts.token });
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

  // Step 3: Create project fields (if projectNumber configured)
  let fields = { created: [], skipped: [] };
  const providerConfig = orchestration[orchestration.provider];
  if (providerConfig?.projectNumber) {
    log(
      `[bootstrap] Ensuring ${PROJECT_FIELD_DEFS.length} project fields on project #${providerConfig.projectNumber}...`,
    );
    fields = await provider.ensureProjectFields(PROJECT_FIELD_DEFS);
    log(
      `[bootstrap] Fields — created: ${fields.created.length}, skipped: ${fields.skipped.length}`,
    );
  } else {
    log('[bootstrap] No projectNumber configured — skipping project fields.');
  }

  log('[bootstrap] Done.');

  return { labels, fields };
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
  } catch (_err) {
    Logger.fatal();
  }
}

runAsCli(import.meta.url, main, { source: 'Bootstrap' });
