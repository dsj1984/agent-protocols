import assert from 'node:assert/strict';
import test from 'node:test';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';
import { runAuditSuite } from '../.agents/scripts/mcp/run-audit-suite.js';
import { selectAudits } from '../.agents/scripts/mcp/select-audits.js';
import { MockProvider } from './fixtures/mock-provider.js';

test('selectAudits: filters based on keywords and gate', async () => {
  const provider = new MockProvider({
    tickets: {
      100: {
        id: 100,
        title: 'Fix UI accessibility issues',
        body: 'The buttons are too small.',
        labels: [],
      },
    },
  });

  // Mock git diff to return no changed files
  __setGitRunners(
    () => '',
    () => ({ status: 0, stdout: '', stderr: '' }),
  );

  const { selectedAudits } = await selectAudits({
    ticketId: 100,
    gate: 'gate2',
    provider,
  });

  // Based on current audit-rules.schema.json, 'audit-accessibility' should be triggered by 'accessibility' keyword
  assert.ok(
    selectedAudits.includes('audit-accessibility'),
    'Should select accessibility audit',
  );
});

test('runAuditSuite: returns workflow content for a valid audit', async () => {
  // Inject a mock loader that returns fake content for audit-clean-code
  const mockLoader = async (auditName, _dir) => {
    if (auditName === 'audit-clean-code') {
      return { content: '# Mock Clean Code Audit\n\nAnalyze the repo.' };
    }
    return null;
  };

  const results = await runAuditSuite({
    auditWorkflows: ['audit-clean-code'],
    injectedLoadWorkflow: mockLoader,
  });

  assert.strictEqual(results.metadata.auditsRun[0], 'audit-clean-code');
  assert.strictEqual(results.workflows.length, 1);
  assert.strictEqual(results.workflows[0].audit, 'audit-clean-code');
  assert.ok(results.workflows[0].content.includes('Mock Clean Code Audit'));
  assert.strictEqual(results.findings.length, 0);
});

test('runAuditSuite: handles unknown audit gracefully', async () => {
  const results = await runAuditSuite({
    auditWorkflows: ['non-existent-audit'],
    injectedLoadWorkflow: async () => null,
  });

  assert.ok(
    results.findings.some((f) => f.message.includes('not defined')),
    'Should report undefined audit',
  );
  assert.strictEqual(results.workflows.length, 0);
});

test('runAuditSuite: reports missing workflow file gracefully', async () => {
  // A valid audit name but the workflow file is missing
  const mockLoader = async () => null;

  const results = await runAuditSuite({
    auditWorkflows: ['audit-clean-code'],
    injectedLoadWorkflow: mockLoader,
  });

  assert.ok(
    results.findings.some((f) => f.message.includes('not found')),
    'Should report missing workflow file',
  );
  assert.strictEqual(results.workflows.length, 0);
  assert.strictEqual(results.metadata.auditsRun.length, 0);
});

test('runAuditSuite: resolves real audit-clean-code.md from disk', async () => {
  const results = await runAuditSuite({
    auditWorkflows: ['audit-clean-code'],
    // No injectedLoadWorkflow — use real filesystem
  });

  assert.strictEqual(results.metadata.auditsRun[0], 'audit-clean-code');
  assert.strictEqual(results.workflows.length, 1);
  assert.ok(
    results.workflows[0].content.length > 0,
    'Workflow content should be non-empty',
  );
});
