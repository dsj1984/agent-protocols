/**
 * tests/plan-run-label-reap.test.js — Story #5189.
 *
 * The cohort label's end of life: one decision engine
 * (`lib/orchestration/plan-run-labels/reap.js`), two surfaces (the per-Story
 * close tail and `prune-plan-run-labels.js`), and the two provider ports both
 * ride on.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ITicketingProvider } from '../.agents/scripts/lib/ITicketingProvider.js';
import { PLAN_RUN_LABEL_PREFIX } from '../.agents/scripts/lib/orchestration/plan-persist/story-ops.js';
import {
  REAP_REASONS,
  reapPlanRunLabelsForStory,
  __testing as reapTesting,
  sweepCohortLabels,
} from '../.agents/scripts/lib/orchestration/plan-run-labels/reap.js';
import { runPostLandTail } from '../.agents/scripts/lib/orchestration/single-story-close/phases/post-land.js';
import {
  isLabelNotFoundError,
  LabelGateway,
} from '../.agents/scripts/providers/github/labels.js';
import {
  formatReport,
  parseArgs,
  runSweep,
} from '../.agents/scripts/prune-plan-run-labels.js';

const {
  decideCohortLabel,
  evaluateCohortLabels,
  isPlanRunLabel,
  reapCohortLabels,
  selectCohortLabels,
} = reapTesting;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CLI = path.join(
  REPO_ROOT,
  '.agents',
  'scripts',
  'prune-plan-run-labels.js',
);

const COHORT_A = `${PLAN_RUN_LABEL_PREFIX}aaaa1111`;
const COHORT_B = `${PLAN_RUN_LABEL_PREFIX}bbbb2222`;
const COHORT_C = `${PLAN_RUN_LABEL_PREFIX}cccc3333`;

/**
 * A provider stub whose only knowledge is "which issues carry which label".
 * Records every delete so a test can assert what was — and was not — written.
 *
 * @param {{
 *   issuesByLabel?: Record<string, Array<{ number: number, state: string }>>,
 *   labels?: string[],
 *   ticketLabels?: string[],
 *   failRead?: boolean,
 *   failDelete?: boolean,
 * }} spec
 */
function makeProvider({
  issuesByLabel = {},
  labels = null,
  ticketLabels = [],
  failRead = false,
  failDelete = false,
} = {}) {
  const deleted = [];
  return {
    deleted,
    async getTicket(id) {
      return { id, labels: ticketLabels };
    },
    async listLabels() {
      if (failRead) throw new Error('label listing exploded');
      const names = labels ?? Object.keys(issuesByLabel);
      return names.map((name) => ({ name, color: null, description: null }));
    },
    async listIssuesByLabel({ state, labels: label }) {
      if (failRead) throw new Error('issue listing exploded');
      assert.equal(state, 'all', 'the decision must read closed issues too');
      return issuesByLabel[label] ?? [];
    },
    async deleteLabel(name) {
      if (failDelete) throw new Error(`delete of ${name} exploded`);
      deleted.push(name);
      return { deleted: true, reason: null };
    },
  };
}

// ---------------------------------------------------------------------------
// AC-1 — the decision, on all three cohort shapes
// ---------------------------------------------------------------------------
describe('cohort-label decision (AC-1)', () => {
  const provider = makeProvider({
    issuesByLabel: {
      [COHORT_A]: [
        { number: 1, state: 'closed' },
        { number: 2, state: 'closed' },
      ],
      [COHORT_B]: [
        { number: 3, state: 'closed' },
        { number: 4, state: 'open' },
      ],
      [COHORT_C]: [],
    },
  });

  it('reports a wholly-closed cohort as reapable', async () => {
    const d = await decideCohortLabel({ provider, label: COHORT_A });
    assert.equal(d.reapable, true);
    assert.equal(d.reason, REAP_REASONS.ALL_CLOSED);
    assert.equal(d.issueCount, 2);
    assert.deepEqual(d.openIssues, []);
  });

  it('reports a cohort with one open Story as open-stories, not reapable', async () => {
    const d = await decideCohortLabel({ provider, label: COHORT_B });
    assert.equal(d.reapable, false);
    assert.equal(d.reason, REAP_REASONS.OPEN_STORIES);
    assert.deepEqual(d.openIssues, [4]);
  });

  it('reports a zero-issue cohort as unreferenced', async () => {
    const d = await decideCohortLabel({ provider, label: COHORT_C });
    assert.equal(d.reason, REAP_REASONS.UNREFERENCED);
    assert.equal(d.issueCount, 0);
  });

  it('treats an unrecognised issue state as open rather than as safe', async () => {
    const odd = makeProvider({
      issuesByLabel: { [COHORT_A]: [{ number: 9, state: 'CLOSED' }] },
    });
    const closed = await decideCohortLabel({ provider: odd, label: COHORT_A });
    assert.equal(closed.reapable, true, 'state comparison is case-insensitive');

    const unknown = makeProvider({
      issuesByLabel: { [COHORT_A]: [{ number: 9, state: 'triaged' }] },
    });
    const d = await decideCohortLabel({ provider: unknown, label: COHORT_A });
    assert.equal(d.reapable, false);
    assert.equal(d.reason, REAP_REASONS.OPEN_STORIES);
  });

  it('evaluates a set in sorted order and ignores non-cohort labels', async () => {
    const decisions = await evaluateCohortLabels({
      provider,
      labels: [COHORT_C, 'type::story', COHORT_A, COHORT_A, 'agent::done'],
    });
    assert.deepEqual(
      decisions.map((d) => d.label),
      [COHORT_A, COHORT_C],
    );
  });

  it('takes the prefix from the minting constant, not a copy', () => {
    assert.equal(PLAN_RUN_LABEL_PREFIX, 'plan-run::');
    assert.equal(isPlanRunLabel(COHORT_A), true);
    assert.equal(isPlanRunLabel('type::story'), false);
    assert.equal(isPlanRunLabel(undefined), false);
    assert.deepEqual(
      selectCohortLabels([{ name: COHORT_B }, { name: 'route::lite' }, null]),
      [COHORT_B],
    );
  });
});

// ---------------------------------------------------------------------------
// AC-2 — a zero-issue label survives a default sweep
// ---------------------------------------------------------------------------
describe('unreferenced cohort labels (AC-2)', () => {
  it('does not delete a zero-issue label on a default run', async () => {
    const provider = makeProvider({
      issuesByLabel: {
        [COHORT_C]: [],
        [COHORT_A]: [{ number: 1, state: 'closed' }],
      },
    });
    const out = await reapCohortLabels({
      provider,
      labels: [COHORT_A, COHORT_C],
    });
    assert.deepEqual(out.reapable, [COHORT_A]);
    assert.deepEqual(provider.deleted, [COHORT_A]);
    const unref = out.decisions.find((d) => d.label === COHORT_C);
    assert.equal(unref.reapable, false);
    assert.equal(unref.reason, REAP_REASONS.UNREFERENCED);
  });

  it('deletes a zero-issue label only under the explicit opt-in', async () => {
    const provider = makeProvider({ issuesByLabel: { [COHORT_C]: [] } });
    const out = await reapCohortLabels({
      provider,
      labels: [COHORT_C],
      includeUnreferenced: true,
    });
    assert.deepEqual(out.reapable, [COHORT_C]);
    assert.deepEqual(provider.deleted, [COHORT_C]);
    assert.equal(
      out.decisions[0].reason,
      REAP_REASONS.UNREFERENCED,
      'the opt-in changes the verdict, never the recorded reason',
    );
  });

  it('a check run writes nothing at all', async () => {
    const provider = makeProvider({
      issuesByLabel: { [COHORT_A]: [{ number: 1, state: 'closed' }] },
    });
    const out = await reapCohortLabels({
      provider,
      labels: [COHORT_A],
      check: true,
    });
    assert.deepEqual(out.reapable, [COHORT_A]);
    assert.deepEqual(provider.deleted, []);
    assert.deepEqual(out.deleted, []);
  });

  it('counts an already-gone label as a successful, idempotent no-op', async () => {
    const provider = {
      ...makeProvider({
        issuesByLabel: { [COHORT_A]: [{ number: 1, state: 'closed' }] },
      }),
      async deleteLabel() {
        return { deleted: false, reason: 'not-found' };
      },
    };
    const out = await reapCohortLabels({ provider, labels: [COHORT_A] });
    assert.deepEqual(out.failed, []);
    assert.deepEqual(out.deleted, [{ label: COHORT_A, existed: false }]);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — the close-path reap
// ---------------------------------------------------------------------------
describe('per-Story reap on close (AC-3)', () => {
  it('deletes the cohort label when the closing Story was its last open member', async () => {
    const provider = makeProvider({
      ticketLabels: ['type::story', COHORT_A],
      issuesByLabel: { [COHORT_A]: [{ number: 5189, state: 'closed' }] },
    });
    const out = await reapPlanRunLabelsForStory({ storyId: 5189, provider });
    assert.equal(out.evaluated, 1);
    assert.deepEqual(provider.deleted, [COHORT_A]);
  });

  it('leaves the cohort label in place while a sibling Story is still open', async () => {
    const provider = makeProvider({
      ticketLabels: ['type::story', COHORT_B],
      issuesByLabel: {
        [COHORT_B]: [
          { number: 5189, state: 'closed' },
          { number: 5190, state: 'open' },
        ],
      },
    });
    const out = await reapPlanRunLabelsForStory({ storyId: 5189, provider });
    assert.deepEqual(provider.deleted, []);
    assert.equal(out.decisions[0].reason, REAP_REASONS.OPEN_STORIES);
  });

  it('never reaps an unreferenced label from the close path', async () => {
    const provider = makeProvider({
      ticketLabels: [COHORT_C],
      issuesByLabel: { [COHORT_C]: [] },
    });
    await reapPlanRunLabelsForStory({ storyId: 5189, provider });
    assert.deepEqual(provider.deleted, []);
  });

  it('does no provider reads at all for a Story carrying no cohort label', async () => {
    const provider = makeProvider({ ticketLabels: ['type::story'] });
    const out = await reapPlanRunLabelsForStory({ storyId: 5189, provider });
    assert.equal(out.evaluated, 0);
    assert.deepEqual(out.decisions, []);
    assert.deepEqual(provider.deleted, []);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — the close-path reap is best-effort
// ---------------------------------------------------------------------------
describe('close-path reap never fails the close (AC-4)', () => {
  /**
   * Run the real `runPostLandTail` with every step other than the reap stubbed
   * to a healthy no-op, so the returned envelope isolates the reap's effect.
   */
  async function runTail(provider, progressLines) {
    const ok = async () => ({ ok: true, detail: null });
    return runPostLandTail({
      storyId: 5189,
      storyBranch: 'story-5189',
      baseBranch: 'main',
      cwd: REPO_ROOT,
      provider,
      config: {},
      progress: (_tag, msg) => progressLines.push(msg),
      captureStoryFollowUpsFn: async () => ({ ok: true }),
      emitCloseRecoveredFrictionFn: async () => {},
      emitRecoveredFrictionMarkerFn: async () => {},
      reassertStatusColumnFn: async () => ({ ok: true, changed: false }),
      gitSpawnFn: () => ({ status: 0, stdout: '', stderr: '' }),
      planFastForwardFn: async () => ({ action: 'skip', reason: 'test' }),
      executeFastForwardFn: async () => ({ ok: true }),
      acquireLockWithWaitFn: async () => ({
        acquired: true,
        release: () => {},
      }),
      purgeStoryTempArtifactsFn: async () => ({ ok: true }),
      releaseStoryLeaseFn: ok,
    });
  }

  const nothingReapable = makeProvider({
    ticketLabels: ['type::story', COHORT_B],
    issuesByLabel: {
      [COHORT_B]: [
        { number: 5189, state: 'closed' },
        { number: 5190, state: 'open' },
      ],
    },
  });

  it('reports the same envelope when the label read throws', async () => {
    const baselineLines = [];
    const baseline = await runTail(nothingReapable, baselineLines);

    const lines = [];
    const tail = await runTail(
      makeProvider({ ticketLabels: [COHORT_A], failRead: true }),
      lines,
    );
    assert.deepEqual(tail, baseline);
    assert.ok(
      lines.some((l) => /plan-run label reap.*(threw|exploded)/i.test(l)),
      `expected a warning naming the failure, got: ${lines.join(' | ')}`,
    );
  });

  it('reports the same envelope when the delete throws', async () => {
    const baselineLines = [];
    const baseline = await runTail(nothingReapable, baselineLines);

    const lines = [];
    const provider = makeProvider({
      ticketLabels: [COHORT_A],
      issuesByLabel: { [COHORT_A]: [{ number: 5189, state: 'closed' }] },
      failDelete: true,
    });
    const tail = await runTail(provider, lines);
    assert.deepEqual(tail, baseline);
    assert.ok(
      lines.some((l) => l.includes('could not delete cohort label')),
      `expected a warning naming the failed delete, got: ${lines.join(' | ')}`,
    );
    assert.ok(
      lines.some((l) => l.includes('prune-plan-run-labels.js')),
      'the warning names the manual sweep as the remedy',
    );
  });

  it('does not add a key to the tail envelope on the happy path either', async () => {
    const lines = [];
    const provider = makeProvider({
      ticketLabels: [COHORT_A],
      issuesByLabel: { [COHORT_A]: [{ number: 5189, state: 'closed' }] },
    });
    const tail = await runTail(provider, lines);
    const baseline = await runTail(nothingReapable, []);
    assert.deepEqual(Object.keys(tail).sort(), Object.keys(baseline).sort());
    assert.deepEqual(provider.deleted, [COHORT_A]);
    assert.ok(lines.some((l) => l.includes('Reaped 1 spent plan-run label')));
  });
});

// ---------------------------------------------------------------------------
// AC-5 / AC-6 — the manual sweep CLI
// ---------------------------------------------------------------------------
describe('prune-plan-run-labels CLI (AC-5, AC-6)', () => {
  /** Drive the CLI's real argv parsing / rendering / exit code over a stub. */
  async function invoke(argv, provider) {
    const out = [];
    const warnings = [];
    const code = await runSweep(argv, {
      createProviderFn: () => provider,
      resolveConfigFn: () => ({}),
      writeFn: (text) => out.push(text),
      warnFn: (message) => warnings.push(message),
    });
    return { code, text: out.join(''), warnings };
  }

  const mixed = () =>
    makeProvider({
      labels: [COHORT_A, COHORT_B, COHORT_C, 'type::story', 'agent::done'],
      issuesByLabel: {
        [COHORT_A]: [{ number: 1, state: 'closed' }],
        [COHORT_B]: [{ number: 2, state: 'open' }],
        [COHORT_C]: [],
      },
    });

  it('--check writes nothing and exits non-zero when a label would be reaped', async () => {
    const provider = mixed();
    const { code, text } = await invoke(['--check'], provider);
    assert.equal(code, 1);
    assert.deepEqual(provider.deleted, [], '--check must delete nothing');
    assert.match(text, /would reap 1 of 3 cohort label\(s\)/);
    assert.match(text, new RegExp(`would reap ${COHORT_A}`));
  });

  it('--check exits 0 when nothing is reapable', async () => {
    const provider = makeProvider({
      labels: [COHORT_B],
      issuesByLabel: { [COHORT_B]: [{ number: 2, state: 'open' }] },
    });
    const { code, text } = await invoke(['--check'], provider);
    assert.equal(code, 0);
    assert.deepEqual(provider.deleted, []);
    assert.match(text, /would reap 0 of 1 cohort label/);
  });

  it('a write run deletes the reapable labels and exits 0', async () => {
    const provider = mixed();
    const { code } = await invoke([], provider);
    assert.equal(code, 0);
    assert.deepEqual(provider.deleted, [COHORT_A]);
  });

  it('--include-unreferenced also sweeps the zero-issue labels', async () => {
    const provider = mixed();
    const { code } = await invoke(['--include-unreferenced'], provider);
    assert.equal(code, 0);
    assert.deepEqual(provider.deleted, [COHORT_A, COHORT_C]);
  });

  it('--check --json names every cohort label with its reason (AC-6)', async () => {
    const provider = mixed();
    const { code, text } = await invoke(['--check', '--json'], provider);
    assert.equal(code, 1);
    const report = JSON.parse(text);
    assert.equal(report.check, true);
    assert.equal(report.totalLabels, 5);
    assert.equal(report.evaluated, 3);
    assert.deepEqual(
      report.decisions.map((d) => [d.label, d.reason, d.reapable]),
      [
        [COHORT_A, REAP_REASONS.ALL_CLOSED, true],
        [COHORT_B, REAP_REASONS.OPEN_STORIES, false],
        [COHORT_C, REAP_REASONS.UNREFERENCED, false],
      ],
    );
    assert.deepEqual(report.deleted, []);
  });

  it('the text report explains why every kept label was kept', async () => {
    const { text } = await invoke(['--check'], mixed());
    assert.match(
      text,
      new RegExp(`keep\\s+${COHORT_B} — open-stories \\(open: 2\\)`),
    );
    assert.match(text, new RegExp(`keep\\s+${COHORT_C} — unreferenced`));
  });

  it('reports a failed delete without aborting the rest of the sweep', async () => {
    const provider = {
      ...mixed(),
      deleted: [],
      async deleteLabel(name) {
        throw new Error(`403 on ${name}`);
      },
    };
    const { code, text, warnings } = await invoke(
      ['--include-unreferenced'],
      provider,
    );
    assert.equal(code, 0, 'a failed delete is a warning, not a hard failure');
    assert.equal(warnings.length, 2, 'both attempts warned');
    assert.match(text, /! failed/);
  });

  it('rejects an unknown flag rather than silently ignoring it', async () => {
    const { code, text } = await invoke(['--dry-run'], mixed());
    assert.equal(code, 2);
    assert.match(JSON.parse(text).error, /unknown flag "--dry-run"/);
  });

  it('parseArgs defaults and --cwd handling', () => {
    const defaults = parseArgs([]);
    assert.equal(defaults.check, false);
    assert.equal(defaults.json, false);
    assert.equal(defaults.includeUnreferenced, false);
    assert.equal(defaults.cwd, process.cwd());
    assert.equal(parseArgs(['--cwd', '/tmp/x']).cwd, '/tmp/x');
    assert.throws(() => parseArgs(['--cwd']), /--cwd requires a directory/);
  });

  it('formatReport survives an empty repository', () => {
    const text = formatReport({
      check: true,
      totalLabels: 0,
      evaluated: 0,
      decisions: [],
      reapable: [],
      deleted: [],
      failed: [],
    });
    assert.match(text, /would reap 0 of 0 cohort label\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — the usage block
// ---------------------------------------------------------------------------
describe('prune-plan-run-labels --help (AC-7)', () => {
  it('prints the invocation and every flag, and performs no work', () => {
    const stdout = execFileSync(process.execPath, [CLI, '--help'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    assert.match(stdout, /node \.agents\/scripts\/prune-plan-run-labels\.js/);
    for (const flag of [
      '--check',
      '--json',
      '--include-unreferenced',
      '--cwd',
    ]) {
      assert.ok(stdout.includes(flag), `usage block omits ${flag}`);
    }
    // No work: `--help` is answered before `main` runs, so neither the report
    // header nor any provider read can have happened (a real read would fail
    // loudly here — the test carries no GitHub credentials by design).
    assert.doesNotMatch(stdout, /\[prune-plan-run-labels\]/);
  });
});

// ---------------------------------------------------------------------------
// AC-8 — the provider ports
// ---------------------------------------------------------------------------
describe('label listing and delete ports (AC-8)', () => {
  /**
   * A `gh` facade stub that serves `per_page`-sized pages, so a fixture larger
   * than one API page proves the port pages rather than truncating.
   */
  function makeGh(labelNames, { deleteImpl } = {}) {
    const calls = [];
    return {
      calls,
      api({ method, endpoint }) {
        calls.push(`${method} ${endpoint}`);
        if (method === 'DELETE') return deleteImpl(endpoint);
        const page = Number(/[?&]page=(\d+)/.exec(endpoint)?.[1] ?? 1);
        const perPage = Number(/[?&]per_page=(\d+)/.exec(endpoint)?.[1] ?? 100);
        const slice = labelNames
          .slice((page - 1) * perPage, page * perPage)
          .map((name) => ({ name, color: 'C5DEF5', description: '' }));
        return { stdout: JSON.stringify(slice) };
      },
    };
  }

  it('lists every cohort label across more labels than one page holds', async () => {
    // 313 labels, 235 of them cohort labels — the measured pile that motivated
    // this Story, and more than the 100-per-page REST default.
    const cohort = Array.from(
      { length: 235 },
      (_, i) => `${PLAN_RUN_LABEL_PREFIX}${String(i).padStart(8, '0')}`,
    );
    const other = Array.from({ length: 78 }, (_, i) => `axis-${i}::v`);
    const gh = makeGh([...other, ...cohort]);
    const gateway = new LabelGateway({ gh, owner: 'o', repo: 'r' });

    const listed = await gateway.listLabels();
    assert.equal(listed.length, 313, 'no page was dropped');
    assert.equal(selectCohortLabels(listed).length, 235);
    assert.ok(
      gh.calls.length >= 4,
      `expected multiple pages, saw ${gh.calls.length} call(s)`,
    );
    // The label that sorts last is precisely the one a fixed page cap loses.
    assert.ok(listed.some((l) => l.name === cohort[cohort.length - 1]));
  });

  it('drops a row with no usable name rather than offering it as a target', async () => {
    const gh = {
      api: () => ({ stdout: JSON.stringify([{ name: COHORT_A }, {}, null]) }),
    };
    const listed = await new LabelGateway({
      gh,
      owner: 'o',
      repo: 'r',
    }).listLabels();
    assert.deepEqual(listed, [
      { name: COHORT_A, color: null, description: null },
    ]);
  });

  it('deletes a label through the REST surface', async () => {
    const gh = makeGh([], { deleteImpl: () => ({ stdout: '' }) });
    const gateway = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gateway.deleteLabel(COHORT_A);
    assert.deepEqual(out, { deleted: true, reason: null });
    assert.deepEqual(gh.calls, [
      `DELETE /repos/o/r/labels/${encodeURIComponent(COHORT_A)}`,
    ]);
  });

  it('treats an already-gone label as a successful no-op', async () => {
    const notFound = () => {
      const err = new Error('gh: Not Found (HTTP 404)');
      err.stderr = 'gh: Not Found (HTTP 404)';
      throw err;
    };
    const gateway = new LabelGateway({
      gh: makeGh([], { deleteImpl: notFound }),
      owner: 'o',
      repo: 'r',
    });
    assert.deepEqual(await gateway.deleteLabel(COHORT_A), {
      deleted: false,
      reason: 'not-found',
    });
  });

  it('keeps a permission failure loud instead of reading it as already-gone', async () => {
    const forbidden = () => {
      const err = new Error('gh: Resource not accessible (HTTP 403)');
      err.stderr = 'HTTP 403';
      throw err;
    };
    const gateway = new LabelGateway({
      gh: makeGh([], { deleteImpl: forbidden }),
      owner: 'o',
      repo: 'r',
    });
    await assert.rejects(() => gateway.deleteLabel(COHORT_A), /403/);
  });

  it('classifies the not-found signal on every surface it arrives on', () => {
    assert.equal(isLabelNotFoundError(null), false);
    assert.equal(isLabelNotFoundError({ status: 404 }), true);
    assert.equal(isLabelNotFoundError({ statusCode: 404 }), true);
    assert.equal(isLabelNotFoundError({ stderr: 'gh: Not Found' }), true);
    assert.equal(isLabelNotFoundError({ message: 'HTTP 404' }), true);
    assert.equal(isLabelNotFoundError({}), false);
    assert.equal(isLabelNotFoundError({ message: 'HTTP 500' }), false);
  });

  it("preserves a label row's colour and description when present", async () => {
    const gh = {
      api: () => ({
        stdout: JSON.stringify([
          { name: COHORT_A, color: 'C5DEF5', description: 'plan run' },
        ]),
      }),
    };
    const listed = await new LabelGateway({
      gh,
      owner: 'o',
      repo: 'r',
    }).listLabels();
    assert.deepEqual(listed, [
      { name: COHORT_A, color: 'C5DEF5', description: 'plan run' },
    ]);
  });

  it('returns an empty vocabulary when the API body is not a list', async () => {
    const gh = { api: () => ({ stdout: JSON.stringify({ message: 'nope' }) }) };
    const listed = await new LabelGateway({
      gh,
      owner: 'o',
      repo: 'r',
    }).listLabels();
    assert.deepEqual(listed, []);
  });

  it('refuses an empty label name', async () => {
    const gateway = new LabelGateway({ gh: makeGh([]), owner: 'o', repo: 'r' });
    await assert.rejects(
      () => gateway.deleteLabel('  '),
      /a non-empty label name is required/,
    );
  });

  it('declares both ports on the provider interface', async () => {
    const iface = new ITicketingProvider();
    assert.equal(typeof iface.listLabels, 'function');
    assert.equal(typeof iface.deleteLabel, 'function');
    await assert.rejects(
      () => iface.listLabels(),
      /Not implemented: listLabels/,
    );
    await assert.rejects(
      () => iface.deleteLabel('x'),
      /Not implemented: deleteLabel/,
    );
  });

  it('sweepCohortLabels reads the whole vocabulary through the listing port', async () => {
    const provider = makeProvider({
      labels: ['type::story', COHORT_A],
      issuesByLabel: { [COHORT_A]: [{ number: 1, state: 'closed' }] },
    });
    const out = await sweepCohortLabels({ provider, check: true });
    assert.equal(out.totalLabels, 2);
    assert.equal(out.evaluated, 1);
    assert.deepEqual(out.reapable, [COHORT_A]);
  });
});
