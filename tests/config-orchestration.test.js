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
    assert.doesNotThrow(() => validateOrchestrationConfig(null));
  });

  it('undefined orchestration is valid', () => {
    assert.doesNotThrow(() => validateOrchestrationConfig(undefined));
  });

  it('full valid config passes', () => {
    assert.doesNotThrow(() =>
      validateOrchestrationConfig({
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
      }),
    );
  });

  it('null projectNumber is valid', () => {
    assert.doesNotThrow(() =>
      validateOrchestrationConfig({
        provider: 'github',
        github: {
          owner: 'org',
          repo: 'my-repo',
          projectNumber: null,
        },
      }),
    );
  });

  it('minimal valid config (no notifications, no projectNumber)', () => {
    assert.doesNotThrow(() =>
      validateOrchestrationConfig({
        provider: 'github',
        github: {
          owner: 'org',
          repo: 'my-repo',
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// validateOrchestrationConfig — invalid configs (schema violations)
// ---------------------------------------------------------------------------
describe('validateOrchestrationConfig — schema violations', () => {
  it('rejects non-object orchestration', () => {
    assert.throws(
      () => validateOrchestrationConfig('string'),
      /must be an object/,
    );
  });

  it('rejects array orchestration', () => {
    assert.throws(() => validateOrchestrationConfig([]), /must be an object/);
  });

  it('rejects missing provider', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          github: { owner: 'org', repo: 'repo' },
        }),
      /must have required property 'provider'/,
    );
  });

  it('rejects unsupported provider', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'jira',
          github: { owner: 'org', repo: 'repo' },
        }),
      /must be equal to one of the allowed values/,
    );
  });

  it('rejects missing owner', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { repo: 'my-repo' },
        }),
      /must have required property 'owner'/,
    );
  });

  it('rejects missing repo', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org' },
        }),
      /must have required property 'repo'/,
    );
  });

  it('rejects empty owner string', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: '', repo: 'my-repo' },
        }),
      /must NOT have fewer than 1 characters/,
    );
  });

  it('rejects bad operatorHandle (no @ prefix)', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org', repo: 'repo', operatorHandle: 'no-prefix' },
        }),
      /must match pattern/,
    );
  });

  it('rejects invalid projectNumber (string)', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org', repo: 'repo', projectNumber: 'abc' },
        }),
      /must be integer,null/,
    );
  });

  it('rejects additional properties', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org', repo: 'repo' },
          unknownField: true,
        }),
      /must NOT have additional properties/,
    );
  });
});

// ---------------------------------------------------------------------------
// validateOrchestrationConfig — security (shell injection)
// ---------------------------------------------------------------------------
describe('validateOrchestrationConfig — shell injection', () => {
  it('rejects shell injection in owner', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'foo; rm -rf /', repo: 'bar' },
        }),
      /\[Security\]/,
    );
  });

  it('rejects shell injection in repo', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org', repo: 'bar$(evil)' },
        }),
      /\[Security\]/,
    );
  });

  it('rejects shell injection in operatorHandle', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org', repo: 'repo', operatorHandle: '@user|hack' },
        }),
      /\[Security\]/,
    );
  });

  it('rejects shell injection in webhookUrl', () => {
    assert.throws(
      () =>
        validateOrchestrationConfig({
          provider: 'github',
          github: { owner: 'org', repo: 'repo' },
          notifications: { webhookUrl: 'https://evil.com;curl attacker' },
        }),
      /\[Security\]/,
    );
  });
});
