import assert from 'node:assert/strict';
import test from 'node:test';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';
import { runAuditSuite } from '../.agents/scripts/mcp/run-audit-suite.js';
import {
  matchesFilePattern,
  selectAudits,
} from '../.agents/scripts/mcp/select-audits.js';
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

// --- Glob regression (Task #543): pin `picomatch` engine semantics so a
// future swap can't silently change matching behavior. Note: the Task body
// listed `**/*.lock` vs `package-lock.json` — that's glob-incorrect
// (`*.lock` only matches filenames ending in `.lock`), so the fixture
// filename is `yarn.lock`, a real `.lock` file. See Story #524 comment.
test('matchesFilePattern: **.js does NOT match bundlejs', () => {
  assert.strictEqual(matchesFilePattern('**.js', 'bundlejs'), false);
});

test('matchesFilePattern: **/*.lock matches yarn.lock', () => {
  assert.strictEqual(matchesFilePattern('**/*.lock', 'yarn.lock'), true);
});

test('matchesFilePattern: **/auth/*.js matches src/auth/login.js', () => {
  assert.strictEqual(
    matchesFilePattern('**/auth/*.js', 'src/auth/login.js'),
    true,
  );
});

test('matchesFilePattern: *.md matches README.md', () => {
  assert.strictEqual(matchesFilePattern('*.md', 'README.md'), true);
});

// --- Timeout fallback (Task #543): inject a git-spawn that never resolves
// and assert selectAudits logs an ETIMEDOUT warning and returns keyword-only
// results without throwing.
test('selectAudits: ETIMEDOUT fallback logs warn and returns keyword-only results', async () => {
  const provider = new MockProvider({
    tickets: {
      200: {
        id: 200,
        title: 'Improve accessibility of modal dialogs',
        body: 'Screen-reader coverage is missing on the confirm modal.',
        labels: [],
      },
    },
  });

  // Never-resolving spawn forces withTimeout to fire its ETIMEDOUT branch.
  const neverResolves = () => new Promise(() => {});

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };

  let result;
  try {
    result = await selectAudits({
      ticketId: 200,
      gate: 'gate2',
      provider,
      baseBranch: 'main',
      injectedGitSpawn: neverResolves,
      gitTimeoutMsOverride: 50,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(
    warnings.some((w) => /git-spawn timed out/i.test(w)),
    `expected an ETIMEDOUT warn log, got: ${JSON.stringify(warnings)}`,
  );
  assert.strictEqual(
    result.context.changedFilesCount,
    0,
    'changedFiles should be empty after the timeout fallback',
  );
  // Keyword-only matching should still select accessibility on the ticket title.
  assert.ok(
    result.selectedAudits.includes('audit-accessibility'),
    `expected keyword-only accessibility match, got: ${JSON.stringify(result.selectedAudits)}`,
  );
});
