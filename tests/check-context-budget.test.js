import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  AGENT_BOOT_CEILING_BYTES,
  agentBootOverflow,
  buildBaseline,
  diffBudget,
  GATED_TIERS,
  loadBaseline,
  parseArgv,
  renderDiff,
  renderReachable,
  runCli,
} from '../.agents/scripts/check-context-budget.js';

/**
 * Unit coverage for the context-budget ratchet (Story #4438).
 *
 * Exercises the pure helpers, then drives `runCli` end-to-end against tmpdir
 * fixtures: a seeded budget passes; an artificial byte increase beyond
 * tolerance to an always-loaded file fails naming the tier; a missing budget
 * and an empty resolved tier are clean no-ops.
 */

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSink() {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join('') };
}

/**
 * Materialize a fixture repo with a CLAUDE.md closure + a context doc under a
 * fresh tmpdir. Returns `{ root, config }`.
 */
function makeRepo({
  withClaude = true,
  docsContextFiles = ['architecture.md'],
  withWorkflows = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-budget-'));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  if (withClaude) {
    write('CLAUDE.md', '@AGENTS.md\n');
    write('AGENTS.md', 'onboarding context\n');
  }
  if (withWorkflows) {
    write(
      '.agents/workflows/deliver.md',
      '---\ndescription: fixture\nmandatoryReads: [helpers/digest.md]\n---\n\n# /deliver\n\n[digest](helpers/digest.md) [appendix](helpers/appendix.md)\n',
    );
    write('.agents/workflows/helpers/digest.md', '# Digest\n');
    write('.agents/workflows/helpers/appendix.md', '# Appendix\n');
  }
  write('docs/architecture.md', 'architecture doc body\n');
  const config = {
    project: { paths: { docsRoot: 'docs' }, docsContextFiles },
  };
  return { root, config, write };
}

// ---------------------------------------------------------------------------
// parseArgv
// ---------------------------------------------------------------------------

test('parseArgv reads baseline, root, update, json', () => {
  assert.deepEqual(
    parseArgv(['--baseline', 'b.json', '--root', 'r', '--update', '--json']),
    { baselinePath: 'b.json', rootPath: 'r', update: true, json: true },
  );
  assert.deepEqual(parseArgv([]), {
    baselinePath: null,
    rootPath: null,
    update: false,
    json: false,
  });
});

// ---------------------------------------------------------------------------
// diffBudget / buildBaseline / renderDiff pure helpers
// ---------------------------------------------------------------------------

test('diffBudget flags growth beyond tolerance and names the tier', () => {
  const tierMap = {
    tiers: {
      alwaysLoaded: [{ path: 'CLAUDE.md', bytes: 5000 }],
      mandatoryRead: [],
    },
  };
  const baseline = {
    toleranceBytes: 100,
    tiers: {
      alwaysLoaded: { totalBytes: 4000 },
      mandatoryRead: { totalBytes: 0 },
    },
  };
  const diff = diffBudget(tierMap, baseline);
  assert.equal(diff.grown.length, 1);
  assert.equal(diff.grown[0].tier, 'alwaysLoaded');
  assert.equal(diff.grown[0].delta, 1000);
  // mandatoryRead resolved empty → skipped, not failed.
  assert.ok(diff.skipped.includes('mandatoryRead'));
});

test('diffBudget treats within-tolerance growth as clean and shrink as informational', () => {
  const baseline = {
    toleranceBytes: 500,
    tiers: { alwaysLoaded: { totalBytes: 4000 } },
  };
  const within = diffBudget(
    { tiers: { alwaysLoaded: [{ path: 'x', bytes: 4200 }] } },
    baseline,
  );
  assert.deepEqual(within.grown, []);

  const shrunk = diffBudget(
    { tiers: { alwaysLoaded: [{ path: 'x', bytes: 3000 }] } },
    baseline,
  );
  assert.equal(shrunk.grown.length, 0);
  assert.equal(shrunk.shrunk.length, 1);
  assert.equal(shrunk.shrunk[0].tier, 'alwaysLoaded');
});

test('buildBaseline records only the gated tiers with totals', () => {
  const envelope = buildBaseline(
    {
      tiers: {
        alwaysLoaded: [{ path: 'CLAUDE.md', bytes: 10 }],
        mandatoryRead: [{ path: 'docs/a.md', bytes: 20 }],
        digestVisible: [{ path: 'docs/s.md', bytes: 999 }],
        onDemand: [{ path: '.agents/rules/x.md', bytes: 999 }],
      },
    },
    2048,
  );
  assert.deepEqual(Object.keys(envelope.tiers).sort(), [...GATED_TIERS].sort());
  assert.equal(envelope.tiers.alwaysLoaded.totalBytes, 10);
  assert.equal(envelope.tiers.mandatoryRead.totalBytes, 20);
  assert.equal(envelope.toleranceBytes, 2048);
});

test('renderDiff tags a gate fail and a clean pass', () => {
  assert.match(
    renderDiff({
      grown: [
        {
          tier: 'alwaysLoaded',
          current: 1,
          baseline: 0,
          tolerance: 0,
          delta: 1,
        },
      ],
      shrunk: [],
      skipped: [],
    }),
    /\(gate fail\)/,
  );
  assert.match(renderDiff({ grown: [], shrunk: [], skipped: [] }), /\(ok\)/);
});

// ---------------------------------------------------------------------------
// agentBootOverflow / buildBaseline agentBoot section
// ---------------------------------------------------------------------------

test('agentBootOverflow flags only role defs above the per-file ceiling', () => {
  const tierMap = {
    tiers: {
      agentBoot: [
        { path: '.agents/agents/story-worker.md', bytes: 7000 },
        { path: '.agents/agents/huge.md', bytes: 9000 },
      ],
    },
  };
  const over = agentBootOverflow(tierMap, 8192);
  assert.equal(over.length, 1);
  assert.equal(over[0].path, '.agents/agents/huge.md');
  assert.equal(over[0].ceiling, 8192);
});

test('agentBootOverflow is empty when there are no agent defs', () => {
  assert.deepEqual(agentBootOverflow({ tiers: {} }), []);
  assert.equal(AGENT_BOOT_CEILING_BYTES, 8192);
});

test('buildBaseline records the agentBoot ceiling + files top-level (not under tiers)', () => {
  const envelope = buildBaseline(
    {
      tiers: {
        alwaysLoaded: [{ path: 'CLAUDE.md', bytes: 10 }],
        mandatoryRead: [],
        agentBoot: [{ path: '.agents/agents/retro.md', bytes: 1800 }],
      },
    },
    2048,
  );
  // agentBoot MUST NOT leak into the ratcheted `tiers` set.
  assert.deepEqual(Object.keys(envelope.tiers).sort(), [...GATED_TIERS].sort());
  assert.equal(envelope.agentBoot.ceilingBytes, 8192);
  assert.deepEqual(envelope.agentBoot.files, [
    { path: '.agents/agents/retro.md', bytes: 1800 },
  ]);
});

// ---------------------------------------------------------------------------
// runCli end-to-end
// ---------------------------------------------------------------------------

test('runCli --update then a clean run exits 0', async () => {
  const { root, config } = makeRepo();
  const stdout = makeSink();
  const updateCode = await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout,
    stderr: makeSink(),
  });
  assert.equal(updateCode, 0);
  assert.ok(fs.existsSync(path.join(root, 'baselines', 'context-budget.json')));

  const check = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  assert.equal(check, 0);
});

test('runCli exits 1 naming the tier that grew beyond tolerance (always-loaded file bloat)', async () => {
  const { root, config } = makeRepo();
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });

  // Artificially bloat an always-loaded file by more than the tolerance.
  const baseline = loadBaseline(
    path.join(root, 'baselines', 'context-budget.json'),
  );
  const bloat = 'x'.repeat(baseline.toleranceBytes + 1000);
  fs.appendFileSync(path.join(root, 'AGENTS.md'), bloat);

  const stdout = makeSink();
  const stderr = makeSink();
  const code = await runCli({ argv: [], cwd: root, config, stdout, stderr });
  assert.equal(code, 1);
  assert.match(stdout.text(), /\+ alwaysLoaded:/);
  assert.match(stderr.text(), /grew beyond tolerance/);
});

test('runCli exits 1 when a role-agent boot context exceeds the per-file ceiling', async () => {
  const { root, config } = makeRepo();
  // A role def larger than the 8192-byte per-agent ceiling.
  fs.mkdirSync(path.join(root, '.agents', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'agents', 'huge.md'),
    'x'.repeat(AGENT_BOOT_CEILING_BYTES + 500),
  );
  // Seed a baseline (records the ceiling); update itself never fails.
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });

  const stdout = makeSink();
  const stderr = makeSink();
  const code = await runCli({ argv: [], cwd: root, config, stdout, stderr });
  assert.equal(code, 1);
  assert.match(stdout.text(), /agentBoot: \.agents\/agents\/huge\.md/);
  assert.match(stderr.text(), /per-agent ceiling/);
});

test('runCli passes when role-agent boot contexts are within the ceiling', async () => {
  const { root, config } = makeRepo();
  fs.mkdirSync(path.join(root, '.agents', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'agents', 'ok.md'),
    'x'.repeat(4000),
  );
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  const code = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  assert.equal(code, 0);
});

// ---------------------------------------------------------------------------
// Workflow mandatory-closure ratchet (Story #4752)
// ---------------------------------------------------------------------------

test('the workflow mandatory closure is a gated tier', () => {
  assert.ok(GATED_TIERS.includes('workflow'));
});

test('--update records the workflow tier and the per-entry-point reachable closure', async () => {
  const { root, config } = makeRepo({ withWorkflows: true });
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  const baseline = loadBaseline(
    path.join(root, 'baselines', 'context-budget.json'),
  );
  assert.ok(baseline.tiers.workflow.totalBytes > 0);
  assert.deepEqual(
    baseline.tiers.workflow.files.map((f) => f.path),
    ['.agents/workflows/deliver.md', '.agents/workflows/helpers/digest.md'],
  );
  // Reachable is recorded alongside the gated tiers, never inside them.
  assert.ok(
    baseline.workflowClosure.reachableTotalBytes >
      baseline.tiers.workflow.totalBytes,
  );
  assert.deepEqual(
    baseline.workflowClosure.entryPoints.map((e) => e.path),
    ['.agents/workflows/deliver.md'],
  );
  assert.ok(baseline.workflowClosure.entryPoints[0].reachableBytes > 0);
});

test('runCli exits 1 when a mandatory workflow read grows beyond tolerance', async () => {
  const { root, config } = makeRepo({ withWorkflows: true });
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  const baseline = loadBaseline(
    path.join(root, 'baselines', 'context-budget.json'),
  );
  fs.appendFileSync(
    path.join(root, '.agents', 'workflows', 'helpers', 'digest.md'),
    'x'.repeat(baseline.toleranceBytes + 1000),
  );
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await runCli({ argv: [], cwd: root, config, stdout, stderr });
  assert.equal(code, 1);
  assert.match(stdout.text(), /\+ workflow:/);
  assert.match(stderr.text(), /grew beyond tolerance/);
});

test('a promoted on-demand read trips the ratchet — the marker, not the bytes, is the signal', async () => {
  const { root, config, write } = makeRepo({ withWorkflows: true });
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  // Same bytes on disk; the appendix is merely re-declared as a mandatory read.
  write(
    '.agents/workflows/helpers/appendix.md',
    `---\ndescription: appendix\n---\n\n# Appendix\n${'y'.repeat(4000)}\n`,
  );
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  write(
    '.agents/workflows/deliver.md',
    '---\ndescription: fixture\nmandatoryReads: [helpers/digest.md, helpers/appendix.md]\n---\n\n# /deliver\n\n[digest](helpers/digest.md) [appendix](helpers/appendix.md)\n',
  );
  const stdout = makeSink();
  const code = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout,
    stderr: makeSink(),
  });
  assert.equal(code, 1);
  assert.match(stdout.text(), /\+ workflow:/);
});

test('growth in the reachable-only closure is reported but never gates', async () => {
  const { root, config } = makeRepo({ withWorkflows: true });
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  // The appendix is reachable but not mandatory — bloat it far past tolerance.
  fs.appendFileSync(
    path.join(root, '.agents', 'workflows', 'helpers', 'appendix.md'),
    'z'.repeat(50_000),
  );
  const stdout = makeSink();
  const code = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout,
    stderr: makeSink(),
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /workflow reachable closure: \d+ bytes/);
  assert.match(stdout.text(), /never gated/);
});

test('a shrunken workflow closure prints the informational marker and still exits 0', async () => {
  const { root, config, write } = makeRepo({ withWorkflows: true });
  write('.agents/workflows/helpers/digest.md', `# Digest\n${'q'.repeat(3000)}`);
  await runCli({
    argv: ['--update'],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  write('.agents/workflows/helpers/digest.md', '# Digest\n');
  const stdout = makeSink();
  const code = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout,
    stderr: makeSink(),
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /- workflow: \d+ bytes below baseline/);
});

test('renderReachable is silent without a workflow closure and cites the recorded total with one', () => {
  assert.equal(renderReachable({}, null), '');
  assert.equal(
    renderReachable({ workflowClosure: { reachableTotalBytes: 0 } }),
    '',
  );
  assert.match(
    renderReachable(
      {
        workflowClosure: {
          reachableTotalBytes: 900,
          entryPoints: [{ path: 'a' }, { path: 'b' }],
        },
      },
      { workflowClosure: { reachableTotalBytes: 800 } },
    ),
    /900 bytes across 2 entry points \(recorded 800\) — drift signal, never gated/,
  );
});

test('runCli propagates a loud workflow-closure failure instead of degrading', async () => {
  const { root, config, write } = makeRepo({ withWorkflows: true });
  write(
    '.agents/workflows/deliver.md',
    '---\ndescription: fixture\nmandatoryReads: [helpers/gone.md]\n---\n\n# /deliver\n',
  );
  await assert.rejects(
    runCli({
      argv: [],
      cwd: root,
      config,
      stdout: makeSink(),
      stderr: makeSink(),
    }),
    /helpers\/gone\.md/,
  );
});

test('runCli is a no-op (exit 0) when the baseline is absent', async () => {
  const { root, config } = makeRepo();
  const stderr = makeSink();
  const code = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr,
  });
  assert.equal(code, 0);
  assert.match(stderr.text(), /budget not found/);
});

test('runCli no-ops (exit 0) against a fixture with no CLAUDE.md — every gated tier empty', async () => {
  // No CLAUDE.md → alwaysLoaded empty; no docsContextFiles → mandatoryRead empty.
  const { root, config } = makeRepo({
    withClaude: false,
    docsContextFiles: [],
  });
  // Seed a baseline that DOES carry both tiers, to prove the empty resolved
  // tiers are skipped (not falsely failed) rather than merely un-compared.
  fs.mkdirSync(path.join(root, 'baselines'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'baselines', 'context-budget.json'),
    JSON.stringify({
      toleranceBytes: 0,
      tiers: {
        alwaysLoaded: { totalBytes: 1, files: [] },
        mandatoryRead: { totalBytes: 1, files: [] },
      },
    }),
  );
  const code = await runCli({
    argv: [],
    cwd: root,
    config,
    stdout: makeSink(),
    stderr: makeSink(),
  });
  assert.equal(code, 0);
});
