import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSettingsValidator } from '../.agents/scripts/lib/config-settings-schema.js';

const validate = getSettingsValidator();

/** Schema-required roots — Epic #730 Story 4. Spread into accept-test inputs
 * that aren't exercising the required-key behaviour itself. */
const REQ = Object.freeze({
  agentRoot: '.agents',
  docsRoot: 'docs',
  tempRoot: 'temp',
});

const expectErrors = (settings, ...needles) => {
  const ok = validate(settings);
  assert.equal(ok, false, 'expected schema validation to fail');
  const joined = (validate.errors || [])
    .map((e) => `${e.instancePath} ${e.message}`)
    .join(' | ');
  for (const needle of needles) {
    assert.match(joined, needle, `missing expected error: ${needle}`);
  }
};

describe('AGENT_SETTINGS_SCHEMA — explicit number/object entries', () => {
  it('accepts integer maxTokenBudget / executionTimeoutMs / executionMaxBuffer', () => {
    assert.equal(
      validate({
        ...REQ,
        maxTokenBudget: 200000,
        executionTimeoutMs: 300000,
        executionMaxBuffer: 10485760,
      }),
      true,
    );
  });

  it('rejects non-integer maxTokenBudget', () => {
    expectErrors({ maxTokenBudget: 'lots' }, /maxTokenBudget/);
  });

  it('rejects executionTimeoutMs below 1', () => {
    expectErrors({ executionTimeoutMs: 0 }, /executionTimeoutMs/);
  });

  it('rejects executionMaxBuffer below 1', () => {
    expectErrors({ executionMaxBuffer: 0 }, /executionMaxBuffer/);
  });

  it('accepts riskGates with heuristics array', () => {
    assert.equal(
      validate({ ...REQ, riskGates: { heuristics: ['no destructive ops'] } }),
      true,
    );
  });

  it('rejects unknown property on riskGates', () => {
    expectErrors(
      { riskGates: { heuristic: ['x'] } },
      /must NOT have additional properties/,
    );
  });

  it('rejects non-string heuristics entries', () => {
    expectErrors({ riskGates: { heuristics: [42] } }, /heuristics\/0/);
  });

  it('accepts quality.prGate with checks array', () => {
    assert.equal(
      validate({
        ...REQ,
        quality: { prGate: { checks: ['lint', 'test'] } },
      }),
      true,
    );
  });

  it('rejects unknown property on quality.prGate', () => {
    expectErrors(
      { ...REQ, quality: { prGate: { check: ['lint'] } } },
      /must NOT have additional properties/,
    );
  });

  it('accepts a full frictionThresholds block', () => {
    assert.equal(
      validate({
        ...REQ,
        frictionThresholds: {
          repetitiveCommandCount: 3,
          consecutiveErrorCount: 3,
          stagnationStepCount: 5,
          maxIntegrationRetries: 2,
        },
      }),
      true,
    );
  });

  it('rejects unknown property on frictionThresholds (typo guard)', () => {
    expectErrors(
      { frictionThresholds: { repetativeCommandCount: 3 } },
      /must NOT have additional properties/,
    );
  });

  it('rejects non-integer frictionThresholds entries', () => {
    expectErrors(
      { frictionThresholds: { repetitiveCommandCount: 'three' } },
      /repetitiveCommandCount/,
    );
  });

  it('rejects frictionThresholds value below 1', () => {
    expectErrors(
      { frictionThresholds: { stagnationStepCount: 0 } },
      /stagnationStepCount/,
    );
  });
});

describe('AGENT_SETTINGS_SCHEMA — required path roots (Epic #730 Story 4)', () => {
  it('rejects an empty agentSettings block, naming all three required keys', () => {
    expectErrors(
      {},
      /must have required property 'agentRoot'/,
      /must have required property 'docsRoot'/,
      /must have required property 'tempRoot'/,
    );
  });

  it('rejects a block missing only agentRoot, naming the missing key', () => {
    expectErrors(
      { docsRoot: 'docs', tempRoot: 'temp' },
      /must have required property 'agentRoot'/,
    );
  });

  it('rejects a block missing only docsRoot, naming the missing key', () => {
    expectErrors(
      { agentRoot: '.agents', tempRoot: 'temp' },
      /must have required property 'docsRoot'/,
    );
  });

  it('rejects a block missing only tempRoot, naming the missing key', () => {
    expectErrors(
      { agentRoot: '.agents', docsRoot: 'docs' },
      /must have required property 'tempRoot'/,
    );
  });

  it('accepts a block that declares all three roots', () => {
    assert.equal(validate({ ...REQ }), true);
  });
});

describe('AGENT_SETTINGS_SCHEMA — quality.crap conditional coveragePath', () => {
  it('accepts crap with enabled=false and no coveragePath', () => {
    assert.equal(
      validate({
        ...REQ,
        quality: { crap: { enabled: false } },
      }),
      true,
    );
  });

  it('accepts crap with requireCoverage=false and no coveragePath', () => {
    assert.equal(
      validate({
        ...REQ,
        quality: {
          crap: { enabled: true, requireCoverage: false },
        },
      }),
      true,
    );
  });

  it('rejects crap when enabled+requireCoverage are true but coveragePath is absent', () => {
    expectErrors(
      {
        ...REQ,
        quality: {
          crap: { enabled: true, requireCoverage: true },
        },
      },
      /must have required property 'coveragePath'/,
    );
  });

  it('accepts crap when enabled+requireCoverage are true and coveragePath is present', () => {
    assert.equal(
      validate({
        ...REQ,
        quality: {
          crap: {
            enabled: true,
            requireCoverage: true,
            coveragePath: 'coverage/coverage-final.json',
          },
        },
      }),
      true,
    );
  });
});
