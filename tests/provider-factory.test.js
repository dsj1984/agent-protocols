/**
 * Provider Factory Tests
 *
 * Tests the factory function that resolves orchestration.provider
 * to a concrete ITicketingProvider class.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, '.agents', 'scripts', 'lib');

// Dynamic import to handle Windows paths
const { createProvider } = await import(
  pathToFileURL(path.join(LIB, 'provider-factory.js')).href
);
const { ITicketingProvider } = await import(
  pathToFileURL(path.join(LIB, 'ITicketingProvider.js')).href
);

// ---------------------------------------------------------------------------
// Factory resolution
// ---------------------------------------------------------------------------
describe('createProvider — factory resolution', () => {
  it('returns a GitHubProvider for provider: "github"', () => {
    const orchestration = {
      provider: 'github',
      github: {
        owner: 'test-owner',
        repo: 'test-repo',
        projectNumber: null,
        operatorHandle: '@test',
      },
    };

    const provider = createProvider(orchestration, { token: 'test-token' });
    assert.ok(provider instanceof ITicketingProvider);
    assert.equal(provider.owner, 'test-owner');
    assert.equal(provider.repo, 'test-repo');
  });

  it('throws when orchestration is null', () => {
    assert.throws(() => createProvider(null), /orchestration is not configured/);
  });

  it('throws when orchestration is undefined', () => {
    assert.throws(() => createProvider(undefined), /orchestration is not configured/);
  });

  it('throws when provider is missing', () => {
    assert.throws(
      () => createProvider({ github: {} }),
      /orchestration\.provider is required/,
    );
  });

  it('throws for unsupported provider', () => {
    assert.throws(
      () => createProvider({ provider: 'jira' }),
      /Unsupported provider "jira"/,
    );
  });

  it('includes supported providers in error message', () => {
    try {
      createProvider({ provider: 'linear' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('github'));
    }
  });

  it('throws when provider-specific config block is missing', () => {
    assert.throws(
      () => createProvider({ provider: 'github' }),
      /orchestration\.github config block is required/,
    );
  });
});
