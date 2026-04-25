import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  AGENT_SETTINGS_SCHEMA,
  AUDITS_SCHEMA,
  ORCHESTRATION_SCHEMA,
} from '../.agents/scripts/lib/config-schema.js';

// ---------------------------------------------------------------------------
// Behavioural drift test: the static .agents/schemas/agentrc.schema.json file
// is the human-readable mirror; the AJV schemas in config-schema.js +
// config-settings-schema.js remain the runtime source of truth. Rather than
// compare structure (which would be brittle because the AJV side uses
// programmatic shortcuts that don't translate to a static JSON file), we
// assert the two surfaces produce the same accept/reject verdicts on a
// curated fixture set covering every block whose typing this Story added.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIRROR_PATH = path.resolve(
  __dirname,
  '..',
  '.agents',
  'schemas',
  'agentrc.schema.json',
);

const mirror = JSON.parse(readFileSync(MIRROR_PATH, 'utf8'));

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addSchema(mirror, 'mirror');

const mirrorValidator = (defName) =>
  ajv.getSchema(`mirror#/$defs/${defName}`) ??
  ajv.compile({ $ref: `mirror#/$defs/${defName}` });

const runtimeAjv = new Ajv({ allErrors: true });
addFormats(runtimeAjv);
const runtimeValidators = {
  agentSettings: runtimeAjv.compile(AGENT_SETTINGS_SCHEMA),
  orchestration: runtimeAjv.compile(ORCHESTRATION_SCHEMA),
  audits: runtimeAjv.compile(AUDITS_SCHEMA),
};

const assertAgree = (block, value, label) => {
  const runtimeOk = runtimeValidators[block](value);
  const mirrorOk = mirrorValidator(block)(value);
  assert.equal(
    mirrorOk,
    runtimeOk,
    `[${block}] ${label}: runtime=${runtimeOk} mirror=${mirrorOk}`,
  );
};

describe('agentrc.schema.json mirror — drift vs runtime AJV schemas', () => {
  it('accepts a fully populated agentSettings block on both sides', () => {
    assertAgree(
      'agentSettings',
      {
        baseBranch: 'main',
        agentRoot: '.agents',
        docsRoot: 'docs',
        tempRoot: 'temp',
        validationCommand: 'npm run lint',
        testCommand: 'npm test',
        maxTickets: 40,
        maxInstructionSteps: 5,
        maxTokenBudget: 200000,
        executionTimeoutMs: 300000,
        executionMaxBuffer: 10485760,
        docsContextFiles: ['architecture.md'],
        maintainability: {
          targetDirs: ['.agents/scripts'],
          crap: {
            enabled: true,
            targetDirs: ['.agents/scripts'],
            newMethodCeiling: 30,
            coveragePath: 'coverage/coverage-final.json',
            tolerance: 0.001,
            requireCoverage: true,
          },
        },
        release: {
          docs: ['README.md'],
          versionFile: '.agents/VERSION',
          packageJson: true,
          autoVersionBump: true,
        },
        sprintClose: { runRetro: true },
        frictionThresholds: {
          repetitiveCommandCount: 3,
          consecutiveErrorCount: 3,
          stagnationStepCount: 5,
          maxIntegrationRetries: 2,
        },
        riskGates: { heuristics: ['no destructive ops'] },
        qualityGate: { checks: ['lint'] },
      },
      'fully populated',
    );
  });

  it('rejects shell-injection in baseBranch on both sides', () => {
    assertAgree(
      'agentSettings',
      { baseBranch: 'main; rm -rf /' },
      'shell injection in baseBranch',
    );
  });

  it('rejects unknown property on riskGates on both sides', () => {
    assertAgree(
      'agentSettings',
      { riskGates: { heuristic: ['x'] } },
      'riskGates typo',
    );
  });

  it('rejects unknown property on qualityGate on both sides', () => {
    assertAgree(
      'agentSettings',
      { qualityGate: { check: ['x'] } },
      'qualityGate typo',
    );
  });

  it('rejects unknown property on frictionThresholds on both sides', () => {
    assertAgree(
      'agentSettings',
      { frictionThresholds: { repetativeCommandCount: 3 } },
      'frictionThresholds typo',
    );
  });

  it('rejects non-integer maxTokenBudget on both sides', () => {
    assertAgree(
      'agentSettings',
      { maxTokenBudget: 'lots' },
      'string maxTokenBudget',
    );
  });

  it('accepts null typecheckCommand on both sides', () => {
    assertAgree(
      'agentSettings',
      { typecheckCommand: null },
      'null typecheckCommand',
    );
  });

  it('accepts null buildCommand on both sides', () => {
    assertAgree('agentSettings', { buildCommand: null }, 'null buildCommand');
  });

  it('rejects empty-string typecheckCommand on both sides', () => {
    assertAgree(
      'agentSettings',
      { typecheckCommand: '' },
      'empty typecheckCommand',
    );
  });

  it('rejects empty-string buildCommand on both sides', () => {
    assertAgree('agentSettings', { buildCommand: '' }, 'empty buildCommand');
  });

  it('accepts a full orchestration block on both sides', () => {
    assertAgree(
      'orchestration',
      {
        provider: 'github',
        github: {
          owner: 'dsj1984',
          repo: 'agent-protocols',
          projectNumber: 1,
          operatorHandle: '@dsj1984',
        },
        notifications: { mentionOperator: false, minLevel: 'medium' },
        worktreeIsolation: {
          enabled: true,
          root: '.worktrees',
          nodeModulesStrategy: 'per-worktree',
        },
        epicRunner: { enabled: true, concurrencyCap: 3, pollIntervalSec: 30 },
        planRunner: { enabled: true, pollIntervalSec: 30 },
      },
      'full orchestration',
    );
  });

  it("rejects provider:'github' with no github block on both sides", () => {
    assertAgree(
      'orchestration',
      { provider: 'github' },
      'missing github block',
    );
  });

  it('rejects missing provider on both sides', () => {
    assertAgree(
      'orchestration',
      { github: { owner: 'org', repo: 'repo' } },
      'missing provider',
    );
  });

  it('rejects unknown top-level orchestration property on both sides', () => {
    assertAgree(
      'orchestration',
      {
        provider: 'github',
        github: { owner: 'org', repo: 'repo' },
        unknownField: true,
      },
      'unknown top-level',
    );
  });

  it('accepts an audits block on both sides', () => {
    assertAgree('audits', { selectionGitTimeoutMs: 30000 }, 'valid audits');
  });

  it('rejects audits.selectionGitTimeoutMs below the floor on both sides', () => {
    assertAgree('audits', { selectionGitTimeoutMs: 500 }, 'audits below floor');
  });

  it('mirror references a draft 2020-12 $schema', () => {
    assert.equal(
      mirror.$schema,
      'https://json-schema.org/draft/2020-12/schema',
    );
  });

  it('mirror exposes agentSettings, orchestration, audits under $defs', () => {
    for (const def of ['agentSettings', 'orchestration', 'audits']) {
      assert.ok(mirror.$defs[def], `mirror is missing $defs.${def}`);
    }
  });
});
