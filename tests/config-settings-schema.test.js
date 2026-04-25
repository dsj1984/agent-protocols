import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSettingsValidator } from '../.agents/scripts/lib/config-settings-schema.js';

const validate = getSettingsValidator();

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
      validate({ riskGates: { heuristics: ['no destructive ops'] } }),
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

  it('accepts qualityGate with checks array', () => {
    assert.equal(validate({ qualityGate: { checks: ['lint', 'test'] } }), true);
  });

  it('rejects unknown property on qualityGate', () => {
    expectErrors(
      { qualityGate: { check: ['lint'] } },
      /must NOT have additional properties/,
    );
  });

  it('accepts a full frictionThresholds block', () => {
    assert.equal(
      validate({
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
