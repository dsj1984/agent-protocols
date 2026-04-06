import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveConfig,
  validateOrchestrationConfig,
} from '../.agents/scripts/lib/config-resolver.js';

// ---------------------------------------------------------------------------
// resolveConfig — orchestration exposure
// ---------------------------------------------------------------------------
describe('resolveConfig — orchestration block', () => {
  it('returns an orchestration property', () => {
    const config = resolveConfig({ bustCache: true });
    assert.ok(
      'orchestration' in config,
      'resolveConfig() result must include an orchestration property',
    );
  });

  it('orchestration is an object or null', () => {
    const config = resolveConfig({ bustCache: true });
    const type = typeof config.orchestration;
    assert.ok(
      config.orchestration === null || type === 'object',
      `orchestration must be null or an object, got: ${type}`,
    );
  });

  // This repo has .agentrc.json with orchestration configured, so it should
  // resolve to a non-null object.
  it('reads orchestration from .agentrc.json (this repo)', () => {
    const config = resolveConfig({ bustCache: true });
    if (config.source.includes('.agentrc.json')) {
      assert.ok(
        config.orchestration !== null,
        'Expected orchestration to be non-null when .agentrc.json has it configured',
      );
      assert.equal(config.orchestration.provider, 'github');
    }
  });
});

// ---------------------------------------------------------------------------
// validateOrchestrationConfig — valid configs
// ---------------------------------------------------------------------------
describe('validateOrchestrationConfig — valid configs', () => {
  it('null orchestration is valid (not configured)', () => {
    const result = validateOrchestrationConfig(null);
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it('undefined orchestration is valid', () => {
    const result = validateOrchestrationConfig(undefined);
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it('full valid config passes', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: {
        owner: 'dsj1984',
        repo: 'agent-protocols',
        projectNumber: 1,
        operatorHandle: '@dsj1984',
      },
      notifications: {
        mentionOperator: true,
        webhookUrl: '',
      },
    });
    assert.ok(result.valid, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('null projectNumber is valid', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: {
        owner: 'org',
        repo: 'my-repo',
        projectNumber: null,
      },
    });
    assert.ok(result.valid, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('minimal valid config (no notifications, no projectNumber)', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: {
        owner: 'org',
        repo: 'my-repo',
      },
    });
    assert.ok(result.valid, `Unexpected errors: ${result.errors.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// validateOrchestrationConfig — invalid configs (schema violations)
// ---------------------------------------------------------------------------
describe('validateOrchestrationConfig — schema violations', () => {
  it('rejects non-object orchestration', () => {
    const result = validateOrchestrationConfig('string');
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('must be an object')));
  });

  it('rejects array orchestration', () => {
    const result = validateOrchestrationConfig([]);
    assert.ok(!result.valid);
  });

  it('rejects missing provider', () => {
    const result = validateOrchestrationConfig({
      github: { owner: 'org', repo: 'repo' },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
  });

  it('rejects unsupported provider', () => {
    const result = validateOrchestrationConfig({
      provider: 'jira',
      github: { owner: 'org', repo: 'repo' },
    });
    assert.ok(!result.valid);
  });

  it('rejects missing owner', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { repo: 'my-repo' },
    });
    assert.ok(!result.valid);
  });

  it('rejects missing repo', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org' },
    });
    assert.ok(!result.valid);
  });

  it('rejects empty owner string', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: '', repo: 'my-repo' },
    });
    assert.ok(!result.valid);
  });

  it('rejects bad operatorHandle (no @ prefix)', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org', repo: 'repo', operatorHandle: 'no-prefix' },
    });
    assert.ok(!result.valid);
  });

  it('rejects invalid projectNumber (string)', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org', repo: 'repo', projectNumber: 'abc' },
    });
    assert.ok(!result.valid);
  });

  it('rejects additional properties', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org', repo: 'repo' },
      unknownField: true,
    });
    assert.ok(!result.valid);
  });
});

// ---------------------------------------------------------------------------
// validateOrchestrationConfig — security (shell injection)
// ---------------------------------------------------------------------------
describe('validateOrchestrationConfig — shell injection', () => {
  it('rejects shell injection in owner', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'foo; rm -rf /', repo: 'bar' },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('[Security]')));
  });

  it('rejects shell injection in repo', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org', repo: 'bar$(evil)' },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('[Security]')));
  });

  it('rejects shell injection in operatorHandle', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org', repo: 'repo', operatorHandle: '@user|hack' },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('[Security]')));
  });

  it('rejects shell injection in webhookUrl', () => {
    const result = validateOrchestrationConfig({
      provider: 'github',
      github: { owner: 'org', repo: 'repo' },
      notifications: { webhookUrl: 'https://evil.com;curl attacker' },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('[Security]')));
  });
});
