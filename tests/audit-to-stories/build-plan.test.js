import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { __testing } from '../../.agents/scripts/audit-to-stories.js';

/**
 * Story #4780, AC-6 — `buildPlan` scored CRAP 110 despite 21 audit-to-stories
 * test files existing: not one of them reached the function that turns audit
 * findings into a dedup-checked plan. This file closes that gap, and covers
 * the two passes that hang off it (`runAuto`, `buildAndGateStories`).
 *
 * The provider, the classifier, and the ledger reconciler are injected
 * through `buildPlan`'s optional final `deps` parameter
 * (`.agents/rules/test-seams.md` rules 1 and 5) — plain functions, no module
 * mocking — so no GitHub lookup happens and no committed ledger is written.
 * The report glob and the report reads run against a real temp directory, so
 * `collectReportPaths` and `readReports` are exercised for real.
 */

const { buildPlan, buildAndGateStories, runAuto, meetsSeverity } = __testing;

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

let workspace;
let reportGlob;
let emptyGlob;

before(() => {
  workspace = fs.mkdtempSync(path.join(tmpdir(), 'audit-build-plan-'));
  const reports = path.join(workspace, 'audits');
  fs.mkdirSync(reports, { recursive: true });
  for (const name of fs.readdirSync(FIXTURES)) {
    fs.copyFileSync(path.join(FIXTURES, name), path.join(reports, name));
  }
  // The fan-out report is deliberately excluded by `collectReportPaths`.
  fs.writeFileSync(
    path.join(reports, 'audit-fan-out-results.md'),
    '# Fan-out\n',
  );
  reportGlob = path.join(reports, 'audit-*-results.md');
  emptyGlob = path.join(workspace, 'nowhere', 'audit-*-results.md');
});

after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

const silent = { logger: { warn: () => {} } };

describe('buildPlan', () => {
  it('returns a zero envelope when the glob matches no report', async () => {
    const plan = await buildPlan(
      { glob: emptyGlob, useProvider: false },
      silent,
    );
    assert.deepEqual(plan.sourceReports, []);
    assert.deepEqual(plan.findings, []);
    assert.deepEqual(plan.groups, []);
    assert.deepEqual(plan.classifications, []);
    assert.equal(plan.severityThreshold, 'all');
    assert.deepEqual(plan.summary, {
      totalFindings: 0,
      filtered: 0,
      create: 0,
      skipOpen: 0,
      skipReoccurring: 0,
    });
  });

  it('parses every report under the glob, excluding the fan-out report', async () => {
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false },
      silent,
    );
    assert.ok(plan.sourceReports.length >= 3);
    assert.equal(
      plan.sourceReports.some((p) => p.endsWith('audit-fan-out-results.md')),
      false,
    );
    assert.ok(plan.summary.totalFindings > 0);
    assert.ok(plan.groups.length > 0);
  });

  it('stamps every finding with a fingerprint and tallies by severity', async () => {
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false },
      silent,
    );
    for (const finding of plan.findings) {
      assert.equal(typeof finding.fingerprint?.full, 'string');
    }
    const tally = plan.summary.tally;
    assert.equal(
      tally.critical + tally.high + tally.medium + tally.low + tally.unknown,
      plan.summary.filtered,
    );
  });

  it('filters findings below the severity threshold', async () => {
    const all = await buildPlan(
      { glob: reportGlob, useProvider: false },
      silent,
    );
    const high = await buildPlan(
      { glob: reportGlob, severity: 'high', useProvider: false },
      silent,
    );
    assert.equal(high.severityThreshold, 'high');
    assert.ok(high.summary.filtered <= all.summary.filtered);
    assert.equal(high.summary.totalFindings, all.summary.totalFindings);
    for (const finding of high.findings) {
      assert.ok(meetsSeverity(finding, 'high'));
    }
  });

  it('classifies every group as create and warns loudly under --no-provider', async () => {
    const warns = [];
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false },
      { logger: { warn: (m) => warns.push(m) } },
    );
    assert.equal(plan.summary.dedupApplied, false);
    assert.ok(plan.classifications.every((c) => c.action === 'create'));
    assert.match(warns[0], /dedup skipped \(--no-provider\)/);
    assert.match(warns[0], /may open\s+duplicates/);
  });

  it('warns loudly when the provider exposes no search port', async () => {
    const warns = [];
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: true },
      {
        loadProviderImpl: async () => null,
        logger: { warn: (m) => warns.push(m) },
      },
    );
    assert.equal(plan.summary.dedupApplied, false);
    assert.match(warns[0], /dedup skipped \(no provider port\)/);
    assert.match(warns[0], /WILL open duplicates/);
  });

  it('adopts the classifier verdict when a provider resolves', async () => {
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: true },
      {
        ...silent,
        loadProviderImpl: async () => ({ searchCandidates: async () => [] }),
        classifyGroupsImpl: async ({ groups }) => ({
          classifications: groups.map((g) => ({
            group: g,
            action: 'skip-open',
            matchedIssues: [{ number: 42, state: 'open' }],
            matchedFingerprints: [],
          })),
          summary: { create: 0, skipOpen: groups.length, skipReoccurring: 0 },
        }),
      },
    );
    assert.equal(plan.summary.dedupApplied, true);
    assert.equal(plan.summary.skipOpen, plan.groups.length);
    assert.ok(plan.classifications.every((c) => c.action === 'skip-open'));
  });

  it('names every group whose dedup lookup degraded', async () => {
    const warns = [];
    await buildPlan(
      { glob: reportGlob, useProvider: true },
      {
        loadProviderImpl: async () => ({}),
        classifyGroupsImpl: async ({ groups }) => ({
          classifications: groups.map((g) => ({ group: g, action: 'create' })),
          summary: {
            create: groups.length,
            skipOpen: 0,
            skipReoccurring: 0,
            dedupDegraded: {
              count: 1,
              groups: [{ group: 'auth', reason: 'HTTP 422' }],
            },
          },
        }),
        logger: { warn: (m) => warns.push(m) },
      },
    );
    assert.match(warns[0], /dedup degraded for 1 group\(s\)/);
    assert.match(warns[0], /- auth: HTTP 422/);
  });

  it('reports the ledger and flips fully-suppressed groups to skip-accepted-risk', async () => {
    const reconcileCalls = [];
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false, ledger: { path: '/led.json' } },
      {
        ...silent,
        reconcileScanLedgerImpl: (args) => {
          reconcileCalls.push(args);
          return new Set(
            args.findings.map((f) => f.fingerprint?.full).filter(Boolean),
          );
        },
      },
    );
    assert.equal(reconcileCalls[0].ledgerPath, '/led.json');
    assert.equal(reconcileCalls[0].write, true);
    assert.equal(plan.summary.ledger.path, '/led.json');
    assert.ok(plan.summary.ledger.suppressed > 0);
    assert.ok(
      plan.classifications.every((c) => c.action === 'skip-accepted-risk'),
    );
  });

  it('leaves classifications alone when the ledger suppresses nothing', async () => {
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false, ledger: { write: false } },
      { ...silent, reconcileScanLedgerImpl: () => new Set() },
    );
    assert.equal(plan.summary.ledger.suppressed, 0);
    assert.ok(plan.classifications.every((c) => c.action === 'create'));
  });

  it('honours ledger.write === false as a read-only reconcile', async () => {
    let seen;
    await buildPlan(
      { glob: reportGlob, useProvider: false, ledger: { write: false } },
      {
        ...silent,
        reconcileScanLedgerImpl: (args) => {
          seen = args;
          return new Set();
        },
      },
    );
    assert.equal(seen.write, false);
  });

  it('omits the ledger summary entirely when no ledger is requested', async () => {
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false },
      silent,
    );
    assert.equal('ledger' in plan.summary, false);
  });
});

describe('buildAndGateStories', () => {
  it('builds one gated Story per eligible group', async () => {
    const plan = await buildPlan(
      { glob: reportGlob, useProvider: false },
      silent,
    );
    const stories = buildAndGateStories(
      plan.classifications.map((c) => c.group),
      plan.edges ?? [],
    );
    assert.equal(stories.length, plan.classifications.length);
    for (const story of stories) {
      assert.equal(typeof story.title, 'string');
      assert.ok(Array.isArray(story.labels));
      assert.match(story.body, /## Acceptance/);
    }
  });

  it('accepts an empty batch', () => {
    assert.deepEqual(buildAndGateStories([], []), []);
  });
});

describe('runAuto', () => {
  it('resolves the floor, reports totals, and files nothing under --dry-run', async () => {
    const { summary, stories } = await runAuto({
      glob: reportGlob,
      severity: 'high',
      dryRun: true,
      useProvider: false,
      ledgerPath: path.join(workspace, 'ledger.json'),
    });
    assert.equal(summary.mode, 'auto');
    assert.equal(summary.dryRun, true);
    assert.equal(summary.severityFloor, 'high');
    assert.deepEqual(stories, []);
    assert.equal(summary.totals.create, summary.totals.groups);
    assert.equal(summary.totals.skipOpen, 0);
    assert.deepEqual(summary.reDetected, []);
    assert.equal(
      fs.existsSync(path.join(workspace, 'ledger.json')),
      false,
      'a dry run must not write the ledger',
    );
  });

  it('returns the create-eligible Story payloads outside --dry-run', async () => {
    const { summary, stories } = await runAuto({
      glob: reportGlob,
      severity: 'low',
      dryRun: false,
      useProvider: false,
      ledgerPath: path.join(workspace, 'ledger-write.json'),
    });
    assert.equal(summary.dryRun, false);
    assert.equal(stories.length, summary.totals.create);
    assert.equal(
      fs.existsSync(path.join(workspace, 'ledger-write.json')),
      true,
    );
  });

  it('reports an empty run without throwing', async () => {
    const { summary, stories } = await runAuto({
      glob: emptyGlob,
      severity: 'high',
      dryRun: true,
      useProvider: false,
    });
    assert.deepEqual(summary.totals, {
      findings: 0,
      filtered: 0,
      groups: 0,
      create: 0,
      skipOpen: 0,
      skipReoccurring: 0,
      suppressedByLedger: 0,
    });
    assert.deepEqual(stories, []);
  });
});
