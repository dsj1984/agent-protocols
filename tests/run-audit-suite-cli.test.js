import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../.agents/scripts/lib/errors/index.js';
import { runAuditSuite as legacyRunAuditSuite } from '../.agents/scripts/mcp/run-audit-suite.js';
import { runAuditSuite } from '../.agents/scripts/run-audit-suite.js';

test('runAuditSuite: post-relocation export and legacy mcp/ shim are the same function', () => {
  assert.equal(runAuditSuite, legacyRunAuditSuite);
});

function makeMockRules() {
  return {
    version: 1,
    audits: {
      'audit-alpha': {
        triggers: { gates: ['gate1'] },
        substitutionKeys: ['alphaKey'],
      },
      'audit-plain': {
        triggers: { gates: ['gate1'] },
        substitutionKeys: [],
      },
    },
  };
}

test('runAuditSuite: built-in substitutions replace template placeholders', async () => {
  const mockLoader = async (auditName) => ({
    content: `# ${auditName} ticket={{ticketId}} base={{baseBranch}} dir={{auditOutputDir}}`,
  });

  const results = await runAuditSuite({
    auditWorkflows: ['audit-plain'],
    substitutions: {
      ticketId: '525',
      baseBranch: 'main',
      auditOutputDir: 'out',
    },
    injectedLoadWorkflow: mockLoader,
    injectedRules: makeMockRules(),
  });

  assert.equal(results.findings.length, 0);
  assert.equal(results.workflows.length, 1);
  assert.match(results.workflows[0].content, /ticket=525/);
  assert.match(results.workflows[0].content, /base=main/);
  assert.match(results.workflows[0].content, /dir=out/);
});

test('runAuditSuite: unknown substitution key raises ValidationError', async () => {
  const mockLoader = async () => ({ content: 'irrelevant' });
  await assert.rejects(
    runAuditSuite({
      auditWorkflows: ['audit-alpha'],
      substitutions: { bogus: 'x' },
      injectedLoadWorkflow: mockLoader,
      injectedRules: makeMockRules(),
    }),
    (err) =>
      err instanceof ValidationError &&
      /bogus/.test(err.message) &&
      err.unknownKeys?.includes('bogus'),
  );
});

test('runAuditSuite: missing workflow file produces a finding (not a throw)', async () => {
  const results = await runAuditSuite({
    auditWorkflows: ['audit-alpha'],
    injectedLoadWorkflow: async () => null,
    injectedRules: makeMockRules(),
  });

  assert.ok(
    results.findings.some((f) => /not found/.test(f.message)),
    'should report a missing-workflow finding',
  );
  assert.equal(results.workflows.length, 0);
  assert.equal(results.metadata.auditsRun.length, 0);
});

test('runAuditSuite: unknown audit produces a "not defined" finding', async () => {
  const results = await runAuditSuite({
    auditWorkflows: ['audit-ghost'],
    injectedLoadWorkflow: async () => null,
    injectedRules: makeMockRules(),
  });

  assert.ok(results.findings.some((f) => /not defined/.test(f.message)));
});

test('runAuditSuite: result envelope shape matches the legacy MCP envelope', async () => {
  const mockLoader = async (auditName) => ({
    content: `# ${auditName}`,
  });

  const results = await runAuditSuite({
    auditWorkflows: ['audit-plain'],
    substitutions: {},
    injectedLoadWorkflow: mockLoader,
    injectedRules: makeMockRules(),
  });

  assert.ok(results.metadata);
  assert.ok(typeof results.metadata.timestamp === 'string');
  assert.deepEqual(results.metadata.auditsRequested, ['audit-plain']);
  assert.deepEqual(results.metadata.auditsRun, ['audit-plain']);
  assert.deepEqual(results.metadata.summary, {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  });
  assert.ok(Array.isArray(results.findings));
  assert.ok(Array.isArray(results.workflows));
});
