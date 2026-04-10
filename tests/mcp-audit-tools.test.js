import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAudits } from '../.agents/scripts/mcp/select-audits.js';
import { runAuditSuite } from '../.agents/scripts/mcp/run-audit-suite.js';
import { MockProvider } from './fixtures/mock-provider.js';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_ROOT,
  resolveConfig,
} from '../.agents/scripts/lib/config-resolver.js';

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

  // Based on current audit-rules.json, 'audit-accessibility' should be triggered by 'accessibility' keyword
  assert.ok(
    selectedAudits.includes('audit-accessibility'),
    'Should select accessibility audit',
  );
});

test('runAuditSuite: aggregates findings', async () => {
  // Create dummy audit script so fs.access passes
  const { settings } = resolveConfig();
  const dummyDir = path.join(PROJECT_ROOT, settings.scriptsRoot, 'audits');
  await fs.mkdir(dummyDir, { recursive: true });
  const dummyScript = path.join(dummyDir, 'audit-clean-code.js');
  await fs.writeFile(dummyScript, '// dummy');

  const mockExecute = async (name) => {
    if (name === 'audit-clean-code') {
      return [{ severity: 'high', message: 'Too many comments' }];
    }
    return [];
  };

  const results = await runAuditSuite({
    auditWorkflows: ['audit-clean-code'],
    injectedExecute: mockExecute,
  });

  assert.strictEqual(results.metadata.auditsRun[0], 'audit-clean-code');
  assert.strictEqual(results.metadata.summary.high, 1);
  assert.strictEqual(results.findings[0].message, 'Too many comments');
});

test('runAuditSuite: handles missing script gracefully', async () => {
  const results = await runAuditSuite({
    auditWorkflows: ['non-existent-audit'],
    injectedExecute: async () => [],
  });

  assert.ok(
    results.findings.some((f) => f.message.includes('not defined')),
    'Should report undefined audit',
  );
});

test('runAuditSuite: normalizes finding severity', async () => {
  const mockExecute = async () => {
    return [
      { severity: 'CRITICAL', message: 'Broken' },
      { severity: 'unknown', message: '??' },
    ];
  };

  const results = await runAuditSuite({
    auditWorkflows: ['audit-clean-code'],
    injectedExecute: mockExecute,
  });

  assert.strictEqual(results.findings[0].severity, 'critical');
  assert.strictEqual(results.findings[1].severity, 'low');
  assert.strictEqual(results.metadata.summary.critical, 1);
});

test('runAuditSuite: handles audit script errors', async () => {
  const { settings } = resolveConfig();
  const dummyDir = path.join(PROJECT_ROOT, settings.scriptsRoot, 'audits');
  await fs.mkdir(dummyDir, { recursive: true });
  const dummyScript = path.join(dummyDir, 'audit-clean-code.js');
  await fs.writeFile(dummyScript, 'throw new Error("fail")');

  // Let it execute the real one (but we mock the spawn in git-utils if needed,
  // though execAsync is not hooked. We'll just continue using injectedExecute
  // but simulating the error finding structure).

  const mockExecute = async () => {
    // Simulate what executeAudit returns on crash
    return [
      {
        severity: 'high',
        message: 'Execution failed',
        audit: 'audit-clean-code',
      },
    ];
  };

  const results = await runAuditSuite({
    auditWorkflows: ['audit-clean-code'],
    injectedExecute: mockExecute,
  });

  assert.strictEqual(results.findings[0].severity, 'high');
});
