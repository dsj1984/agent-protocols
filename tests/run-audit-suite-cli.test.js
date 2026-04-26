import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../.agents/scripts/lib/errors/index.js';
import {
  runAuditSuite,
  summarizeWorkflow,
} from '../.agents/scripts/run-audit-suite.js';

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

test('runAuditSuite: built-in substitutions are applied to artifact bodies', async () => {
  const mockLoader = async (auditName) => ({
    path: `/fake/${auditName}.md`,
    content: `# ${auditName} ticket={{ticketId}} base={{baseBranch}} dir={{auditOutputDir}}`,
  });

  const written = [];
  const mockWriteArtifact = async (dir, fileName, content) => {
    written.push({ dir, fileName, content });
    return `${dir}/${fileName}`;
  };

  const results = await runAuditSuite({
    auditWorkflows: ['audit-plain'],
    substitutions: {
      ticketId: '525',
      baseBranch: 'main',
      auditOutputDir: 'out',
    },
    artifactPrefix: 'gate1-525',
    artifactsDir: '/tmp/audits',
    injectedLoadWorkflow: mockLoader,
    injectedRules: makeMockRules(),
    injectedWriteArtifact: mockWriteArtifact,
  });

  assert.equal(results.findings.length, 0);
  assert.equal(results.workflows.length, 1);
  assert.equal(results.workflows[0].audit, 'audit-plain');
  assert.equal(results.workflows[0].path, '/fake/audit-plain.md');
  assert.equal(
    results.workflows[0].artifactPath,
    '/tmp/audits/audit-gate1-525-audit-plain.md',
  );
  assert.equal(written.length, 1);
  assert.match(written[0].content, /ticket=525/);
  assert.match(written[0].content, /base=main/);
  assert.match(written[0].content, /dir=out/);
  // Slim envelope: full body is not exposed on the workflow descriptor.
  assert.equal(results.workflows[0].content, undefined);
});

test('runAuditSuite: omits artifact write when no run-id / prefix is provided', async () => {
  const mockLoader = async (auditName) => ({
    path: `/fake/${auditName}.md`,
    content: `# ${auditName}`,
  });
  let called = false;
  const results = await runAuditSuite({
    auditWorkflows: ['audit-plain'],
    injectedLoadWorkflow: mockLoader,
    injectedRules: makeMockRules(),
    injectedWriteArtifact: async () => {
      called = true;
      return '/never';
    },
  });
  assert.equal(called, false);
  assert.equal(results.workflows[0].artifactPath, null);
});

test('summarizeWorkflow: prefers frontmatter description over first paragraph', () => {
  const content = [
    '---',
    'description: Run a security and vulnerability audit',
    '---',
    '',
    '# Heading',
    '',
    'Long body content that should be ignored.',
  ].join('\n');
  assert.equal(
    summarizeWorkflow(content),
    'Run a security and vulnerability audit',
  );
});

test('summarizeWorkflow: falls back to first prose paragraph when no description', () => {
  const content = [
    '# Title',
    '',
    'First paragraph. Second sentence. Third sentence. Fourth sentence.',
    '',
    '## Step 1',
  ].join('\n');
  const summary = summarizeWorkflow(content);
  assert.match(summary, /First paragraph/);
  assert.doesNotMatch(summary, /Fourth sentence/);
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

test('runAuditSuite: result envelope shape carries slim workflow descriptors', async () => {
  const mockLoader = async (auditName) => ({
    path: `/fake/${auditName}.md`,
    content: `# ${auditName}\n\nA short description sentence.`,
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
  const wf = results.workflows[0];
  assert.equal(wf.audit, 'audit-plain');
  assert.equal(wf.path, '/fake/audit-plain.md');
  assert.match(wf.summary, /short description/);
  assert.equal(typeof wf.byteSize, 'number');
  assert.equal(wf.artifactPath, null);
  assert.equal(wf.content, undefined);
});
