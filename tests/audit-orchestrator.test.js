import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAuditReport,
  renderFindingsBlock,
  renderSummaryLine,
  renderWorkflowsBlock,
  runAuditOrchestrator,
  severityIcon,
} from '../.agents/scripts/audit-orchestrator.js';
import {
  aggregateSummary,
  runAuditSuite,
} from '../.agents/scripts/run-audit-suite.js';

test('audit-orchestrator imports canonical audit modules', () => {
  assert.equal(typeof runAuditOrchestrator, 'function');
});

test('severityIcon: maps each known severity to its glyph', () => {
  assert.equal(severityIcon('critical'), '🔴');
  assert.equal(severityIcon('high'), '🟠');
  assert.equal(severityIcon('medium'), '🟡');
  assert.equal(severityIcon('low'), '⚪');
  assert.equal(severityIcon('unknown'), '⚪');
});

test('renderFindingsBlock: returns empty string when no findings', () => {
  assert.equal(renderFindingsBlock([]), '');
  assert.equal(renderFindingsBlock(null), '');
});

test('renderFindingsBlock: emits a table row per finding with proper icons', () => {
  const out = renderFindingsBlock([
    { audit: 'sec', severity: 'critical', message: 'broken pipe' },
    { audit: 'a11y', severity: 'medium', message: '' },
  ]);
  assert.match(out, /Audit Configuration Issues/);
  assert.match(out, /\| sec \| 🔴 CRITICAL \| broken pipe \|/);
  assert.match(out, /\| a11y \| 🟡 MEDIUM \| No details provided \|/);
});

test('renderFindingsBlock: replaces newlines in message with <br>', () => {
  const out = renderFindingsBlock([
    { audit: 'x', severity: 'high', message: 'a\nb' },
  ]);
  assert.match(out, /a<br>b/);
});

test('renderWorkflowsBlock: returns empty string when no workflows', () => {
  assert.equal(
    renderWorkflowsBlock([], { critical: 0, high: 0, medium: 0, low: 0 }, []),
    '',
  );
});

test('renderWorkflowsBlock: assembles header + per-workflow body', () => {
  const out = renderWorkflowsBlock(
    [
      { audit: 'a', content: 'one' },
      { audit: 'b', content: 'two' },
    ],
    { critical: 1, high: 0, medium: 2, low: 3 },
    ['a', 'b'],
  );
  assert.match(out, /\*\*Audit Workflows Dispatched:\*\* a, b/);
  assert.match(out, /\*\*Summary:\*\* 🔴 1 Critical \| 🟡 2 Medium \| ⚪ 3 Low/);
  assert.doesNotMatch(out, /0 High/);
  assert.match(out, /### Audit: `a`/);
  assert.match(out, /### Audit: `b`/);
  assert.match(out, /one/);
  assert.match(out, /two/);
});

test('renderSummaryLine: omits zero-count severities', () => {
  assert.equal(
    renderSummaryLine({ critical: 0, high: 2, medium: 0, low: 1 }),
    '**Summary:** 🟠 2 High | ⚪ 1 Low',
  );
});

test('renderSummaryLine: returns empty string when summary is all zeros', () => {
  assert.equal(
    renderSummaryLine({ critical: 0, high: 0, medium: 0, low: 0 }),
    '',
  );
});

test('renderWorkflowsBlock: omits Summary line entirely when nothing populated', () => {
  const out = renderWorkflowsBlock(
    [{ audit: 'a', content: 'one' }],
    { critical: 0, high: 0, medium: 0, low: 0 },
    ['a'],
  );
  assert.match(out, /\*\*Audit Workflows Dispatched:\*\* a/);
  assert.doesNotMatch(out, /\*\*Summary:\*\*/);
});

test('aggregateSummary: counts three findings of distinct severities (fixture)', () => {
  const fixtureFindings = [
    { audit: 'a', severity: 'critical', message: 'tls misconfig' },
    { audit: 'b', severity: 'high', message: 'sql injection' },
    { audit: 'c', severity: 'medium', message: 'stale dep' },
  ];
  assert.deepEqual(aggregateSummary(fixtureFindings), {
    critical: 1,
    high: 1,
    medium: 1,
    low: 0,
  });
});

test('aggregateSummary: ignores findings with non-standard severities', () => {
  assert.deepEqual(
    aggregateSummary([
      { audit: 'x', severity: 'critical' },
      { audit: 'y', severity: 'noisy' },
      { audit: 'z', severity: 'info' },
    ]),
    { critical: 1, high: 0, medium: 0, low: 0 },
  );
});

test('runAuditSuite: summary aggregates findings produced by the suite', async () => {
  const results = await runAuditSuite({
    auditWorkflows: ['audit-ghost-1', 'audit-ghost-2', 'audit-ghost-3'],
    injectedLoadWorkflow: async () => null,
    injectedRules: { version: 1, audits: {} },
  });
  // Three unknown audits -> three 'low'-severity findings.
  assert.equal(results.findings.length, 3);
  assert.deepEqual(results.metadata.summary, {
    critical: 0,
    high: 0,
    medium: 0,
    low: 3,
  });
});

test('formatAuditReport: empty audits + findings prints the no-op line', () => {
  const out = formatAuditReport({
    metadata: {
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      auditsRun: [],
    },
    findings: [],
    workflows: [],
  });
  assert.match(out, /No audits were run during this gate\./);
});

test('formatAuditReport: combined findings + workflows block', () => {
  const out = formatAuditReport({
    metadata: {
      summary: { critical: 0, high: 1, medium: 0, low: 0 },
      auditsRun: ['security'],
    },
    findings: [{ audit: 'security', severity: 'high', message: 'tls' }],
    workflows: [{ audit: 'security', content: '## Run X' }],
  });
  assert.match(out, /Audit Orchestrator Report/);
  assert.match(out, /security \| 🟠 HIGH \| tls/);
  assert.match(out, /Run X/);
});
