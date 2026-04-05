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

import { createProvider } from './lib/provider-factory.js';

// ---------------------------------------------------------------------------
// Label Taxonomy
// ---------------------------------------------------------------------------

/** @type {Array<{ name: string, color: string, description: string }>} */
export const LABEL_TAXONOMY = [
  // Type
  { name: 'type::epic', color: '#7057FF', description: 'Epic-level work item' },
  { name: 'type::feature', color: '#7057FF', description: 'Feature under an Epic' },
  { name: 'type::story', color: '#7057FF', description: 'User story under a Feature' },
  { name: 'type::task', color: '#7057FF', description: 'Implementable task' },

  // Agent State
  { name: 'agent::ready', color: '#0E8A16', description: 'Ready for agent pickup' },
  { name: 'agent::executing', color: '#0E8A16', description: 'Agent is working on this' },
  { name: 'agent::review', color: '#0E8A16', description: 'Awaiting human review' },
  { name: 'agent::done', color: '#0E8A16', description: 'Agent work completed' },

  // Status
  { name: 'status::blocked', color: '#D93F0B', description: 'Blocked by a dependency' },

  // Risk
  { name: 'risk::high', color: '#FBCA04', description: 'High-risk change' },
  { name: 'risk::medium', color: '#FBCA04', description: 'Medium-risk change' },

  // Persona
  { name: 'persona::fullstack', color: '#C5DEF5', description: 'Fullstack engineer persona' },
  { name: 'persona::architect', color: '#C5DEF5', description: 'Architect persona' },
  { name: 'persona::qa', color: '#C5DEF5', description: 'QA engineer persona' },

  // Context
  { name: 'context::prd', color: '#D4C5F9', description: 'Product Requirements Document' },
  { name: 'context::tech-spec', color: '#D4C5F9', description: 'Technical Specification' },

  // Execution
  { name: 'execution::sequential', color: '#F9D0C4', description: 'Must execute sequentially' },
  { name: 'execution::concurrent', color: '#F9D0C4', description: 'Can execute concurrently' },

  // Focus Area
  { name: 'focus::core', color: '#BFD4F2', description: 'Core library changes' },
  { name: 'focus::scripts', color: '#BFD4F2', description: 'Script/tooling changes' },
  { name: 'focus::docs', color: '#BFD4F2', description: 'Documentation changes' },
  { name: 'focus::ci', color: '#BFD4F2', description: 'CI/CD pipeline changes' },
  { name: 'focus::tests', color: '#BFD4F2', description: 'Test suite changes' },
];

// ---------------------------------------------------------------------------
// Project Board Field Definitions
// ---------------------------------------------------------------------------

/** @type {Array<{ name: string, type: 'iteration'|'single_select', options?: string[] }>} */
export const PROJECT_FIELD_DEFS = [
  { name: 'Sprint', type: 'iteration' },
  {
    name: 'Execution',
    type: 'single_select',
    options: ['sequential', 'concurrent'],
  },
  {
    name: 'Focus Area',
    type: 'single_select',
    options: ['core', 'scripts', 'docs', 'ci', 'tests'],
  },
];

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
    console.error(
      '[bootstrap] Add an orchestration config. See .agents/default-agentrc.json for the template.',
    );
    process.exit(1);
  }

  const validation = validateOrchestrationConfig(config.orchestration);
  if (!validation.valid) {
    console.error('[bootstrap] ERROR: Invalid orchestration config:');
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  try {
    const result = await runBootstrap(config.orchestration);

    console.log('\n=== Bootstrap Summary ===');
    console.log(`Labels created: ${result.labels.created.length}`);
    console.log(`Labels skipped: ${result.labels.skipped.length}`);
    console.log(`Fields created: ${result.fields.created.length}`);
    console.log(`Fields skipped: ${result.fields.skipped.length}`);
  } catch (err) {
    console.error(`[bootstrap] FATAL: ${err.message}`);
    process.exit(1);
  }
}

// Run as CLI when invoked directly
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectRun) {
  main();
}
