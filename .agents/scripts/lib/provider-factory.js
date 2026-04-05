/**
 * Provider Factory — resolves `orchestration.provider` to a concrete class.
 *
 * @see docs/v5-implementation-plan.md Sprint 1B
 */

import { GitHubProvider } from '../providers/github.js';

/** @type {Record<string, typeof import('../lib/ITicketingProvider.js').ITicketingProvider>} */
const PROVIDERS = {
  github: GitHubProvider,
};

/**
 * Create a ticketing provider instance from the orchestration config.
 *
 * @param {object|null} orchestration - The orchestration block from .agentrc.json.
 * @param {{ token?: string }} [opts] - Override options (e.g., test token).
 * @returns {import('../lib/ITicketingProvider.js').ITicketingProvider}
 * @throws {Error} If orchestration is not configured or provider is unsupported.
 */
export function createProvider(orchestration, opts = {}) {
  if (!orchestration) {
    throw new Error(
      '[ProviderFactory] orchestration is not configured in .agentrc.json. ' +
      'Add an "orchestration" block with a "provider" field.',
    );
  }

  const providerName = orchestration.provider;
  if (!providerName) {
    throw new Error(
      '[ProviderFactory] orchestration.provider is required.',
    );
  }

  const ProviderClass = PROVIDERS[providerName];
  if (!ProviderClass) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(
      `[ProviderFactory] Unsupported provider "${providerName}". ` +
      `Supported: ${supported}.`,
    );
  }

  // Extract provider-specific config
  const providerConfig = orchestration[providerName];
  if (!providerConfig) {
    throw new Error(
      `[ProviderFactory] orchestration.${providerName} config block is required ` +
      `when provider is "${providerName}".`,
    );
  }

  return new ProviderClass(providerConfig, opts);
}
