/**
 * tests/lib/orchestration/story-close/baseline-upward-writeback.test.js —
 * Story #5224.
 *
 * The upward write-back is the only step in the close that *writes* to a
 * committed baseline, so the tests that matter are the ones that pin what it
 * must never write: a regression, a row for a file outside the branch's own
 * changed set, or a second commit over an already-refreshed tree.
 *
 * Every collaborator is injected per `.agents/rules/test-seams.md` — no git is
 * spawned, no baseline is scored, and nothing touches the real filesystem. The
 * `git` stub records its argv so the assertions can read what the step
 * actually staged and committed rather than inferring it from a return value.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runBaselineUpwardWriteback } from '../../../../.agents/scripts/lib/orchestration/story-close/baseline-upward-writeback.js';

function makeLogger() {
  const logs = { info: [], warn: [], error: [] };
  return {
    logs,
    info: (m) => logs.info.push(m),
    warn: (m) => logs.warn.push(m),
    error: (m) => logs.error.push(m),
  };
}

/**
 * Git stub covering the four subcommands the step issues: the changed-file
 * diff, the branch assertion, `add` and `commit`, plus the `rev-parse` that
 * reports the new SHA.
 */
function makeGit({
  changedFiles = ['.agents/scripts/lib/a.js'],
  onBranch = 'story-5224',
  commitFails = false,
} = {}) {
  const calls = [];
  const git = (args, _opts) => {
    calls.push(args);
    const [cmd] = args;
    if (cmd === 'diff') return `${changedFiles.join('\n')}\n`;
    if (cmd === 'rev-parse' && args.includes('--abbrev-ref'))
      return `${onBranch}\n`;
    if (cmd === 'rev-parse') return 'feedface\n';
    if (cmd === 'commit' && commitFails) {
      const err = new Error('commitlint rejected the subject');
      err.status = 1;
      throw err;
    }
    return '';
  };
  git.calls = calls;
  git.argvFor = (cmd) => calls.filter((c) => c[0] === cmd);
  return git;
}

/** A refresh stub that records what it was asked to persist. */
function makeRefresh({ wrote = true } = {}) {
  const seen = [];
  const refresh = async (opts) => {
    seen.push(opts);
    return { wrote, envelope: {}, kind: opts.kind, writePath: opts.writePath };
  };
  refresh.seen = seen;
  return refresh;
}

/**
 * Drive the step with a hermetic default wiring. `baselineRows` is the
 * committed baseline; `scored` is what the scorer reports for the branch's
 * changed files.
 */
function run({
  baselineRows,
  scored,
  git = makeGit(),
  refresh = makeRefresh(),
  logger = makeLogger(),
  config,
  storyBranch = 'story-5224',
} = {}) {
  return runBaselineUpwardWriteback({
    cwd: '/repo',
    worktreePath: '/repo/.worktrees/story-5224',
    storyId: 5224,
    baseBranch: 'main',
    storyBranch,
    config,
    logger,
    gitSync: git,
    loadBaselineRows: () => baselineRows,
    scoreFiles: () => scored,
    refreshBaseline: refresh,
    resolveWritePath: ({ cwd }) => `${cwd}/baselines/maintainability.json`,
  });
}

describe('runBaselineUpwardWriteback — Story #5224', () => {
  it('AC-1: persists an improved row and commits it on the story branch', async () => {
    const git = makeGit();
    const refresh = makeRefresh();
    const logger = makeLogger();

    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
      refresh,
      logger,
    });

    assert.equal(result.committed, true);
    assert.equal(result.sha, 'feedface');
    assert.deepEqual(result.improvedPaths, ['.agents/scripts/lib/a.js']);

    // The improved head row is what reaches the write funnel.
    assert.equal(refresh.seen.length, 1);
    assert.equal(refresh.seen[0].kind, 'maintainability');
    assert.deepEqual(await refresh.seen[0].scorer(), [
      { path: '.agents/scripts/lib/a.js', mi: 78 },
    ]);

    // Staged the baseline file by path, then committed it.
    assert.deepEqual(git.argvFor('add')[0], [
      'add',
      '--',
      'baselines/maintainability.json',
    ]);
    assert.equal(git.argvFor('commit').length, 1);
    assert.match(logger.logs.warn.join('\n'), /wrote back 1 improved/);
  });

  it('AC-2: writes only rows for files in the branch changed set', async () => {
    const refresh = makeRefresh();

    const result = await run({
      // `b.js` is stale by 20 points but the branch never touched it, so the
      // scorer never reports it and it must not be rewritten.
      baselineRows: [
        { path: '.agents/scripts/lib/a.js', mi: 70 },
        { path: '.agents/scripts/lib/b.js', mi: 60 },
      ],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      refresh,
    });

    assert.deepEqual(result.improvedPaths, ['.agents/scripts/lib/a.js']);
    assert.deepEqual(refresh.seen[0].scopeFiles, ['.agents/scripts/lib/a.js']);
  });

  it('AC-3: never rewrites a regressed row, and commits nothing for it', async () => {
    const git = makeGit();
    const refresh = makeRefresh();

    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 80 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 61 }],
      git,
      refresh,
    });

    assert.equal(result.committed, false);
    assert.equal(result.reason, 'no-improvements');
    assert.equal(refresh.seen.length, 0);
    assert.equal(git.argvFor('commit').length, 0);
  });

  it('AC-3: a regression alongside an improvement leaves the regressed row alone', async () => {
    const refresh = makeRefresh();

    const result = await run({
      baselineRows: [
        { path: '.agents/scripts/lib/a.js', mi: 70 },
        { path: '.agents/scripts/lib/b.js', mi: 90 },
      ],
      scored: [
        { path: '.agents/scripts/lib/a.js', mi: 78 },
        { path: '.agents/scripts/lib/b.js', mi: 71 },
      ],
      refresh,
    });

    assert.deepEqual(result.improvedPaths, ['.agents/scripts/lib/a.js']);
    assert.deepEqual(refresh.seen[0].scopeFiles, ['.agents/scripts/lib/a.js']);
  });

  it('AC-4: a tree with no improvement produces no commit', async () => {
    const git = makeGit();

    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
    });

    assert.equal(result.committed, false);
    assert.equal(result.reason, 'no-improvements');
    assert.equal(git.argvFor('commit').length, 0);
  });

  it('AC-4: idempotent — the second run over the refreshed tree commits nothing', async () => {
    const first = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
    });
    assert.equal(first.committed, true);

    // Re-run against the tree the first run produced: the committed row now
    // carries the improved score, so nothing is left to write.
    const git = makeGit();
    const second = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
    });
    assert.equal(second.committed, false);
    assert.equal(second.reason, 'no-improvements');
    assert.equal(git.argvFor('commit').length, 0);
  });

  it('AC-4: a write the funnel short-circuits produces no commit', async () => {
    const git = makeGit();
    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
      refresh: makeRefresh({ wrote: false }),
    });

    assert.equal(result.committed, false);
    assert.equal(result.reason, 'unchanged');
    assert.equal(git.argvFor('commit').length, 0);
  });

  it('AC-5: the subject is conventional, carries the refresh marker, and fits commitlint', async () => {
    const git = makeGit();
    await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
    });

    const [commit] = git.argvFor('commit');
    const subject = commit[commit.indexOf('-m') + 1];
    assert.match(subject, /^chore\(baselines\): /);
    assert.ok(
      subject.includes('baseline-refresh:'),
      `subject must carry the acknowledgement marker: ${subject}`,
    );
    assert.ok(
      subject.length <= 100,
      `subject must fit commitlint's 100-char cap (was ${subject.length})`,
    );
    assert.equal(subject.includes('\n'), false);

    // Non-empty body naming the rows, per the drift-check remedy contract.
    const body = commit[commit.lastIndexOf('-m') + 1];
    assert.ok(body.length > 0);
    assert.match(body, /\.agents\/scripts\/lib\/a\.js: 70\.00 -> 78\.00/);
  });

  it('AC-6: only the maintainability baseline is ever written', async () => {
    const refresh = makeRefresh();
    const git = makeGit();
    await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
      refresh,
    });

    assert.deepEqual(
      refresh.seen.map((o) => o.kind),
      ['maintainability'],
    );
    for (const argv of git.argvFor('add')) {
      assert.equal(argv.includes('baselines/crap.json'), false);
    }
  });

  it('honours the CONFIGURED gate tolerance, not just the framework default', async () => {
    // +4.0 clears the 0.5 default comfortably, so a step reading the wrong
    // tolerance source would write this row. The gate declares 5.
    const opts = {
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 74 }],
    };
    const tightened = await run({
      ...opts,
      config: {
        delivery: {
          quality: {
            gates: {
              maintainability: { tolerance: { kind: 'absolute', value: 5 } },
            },
          },
        },
      },
    });
    assert.equal(tightened.committed, false);
    assert.equal(tightened.reason, 'no-improvements');

    // Same movement, framework default tolerance → written.
    const byDefault = await run(opts);
    assert.equal(byDefault.committed, true);
  });

  it('a file new to the baseline is an addition, not an improvement', async () => {
    const refresh = makeRefresh();
    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/other.js', mi: 90 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 88 }],
      refresh,
    });
    assert.equal(result.committed, false);
    assert.equal(result.reason, 'no-improvements');
    assert.equal(refresh.seen.length, 0);
  });

  it('refuses to write when the worktree is not on the story branch', async () => {
    const git = makeGit({ onBranch: 'main' });
    const refresh = makeRefresh();
    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      git,
      refresh,
    });

    assert.equal(result.reason, 'wrong-branch');
    // The refusal must precede the write, not follow it.
    assert.equal(refresh.seen.length, 0);
    assert.equal(git.argvFor('add').length, 0);
  });

  it('skips when the gate is disabled', async () => {
    const refresh = makeRefresh();
    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      refresh,
      config: {
        delivery: {
          quality: { gates: { maintainability: { enabled: false } } },
        },
      },
    });
    assert.equal(result.ran, false);
    assert.equal(result.reason, 'gate-disabled');
    assert.equal(refresh.seen.length, 0);
  });

  it('skips when the branch changed no scorable file', async () => {
    const refresh = makeRefresh();
    const result = await run({
      git: makeGit({ changedFiles: ['docs/architecture.md', 'README.md'] }),
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
      refresh,
    });
    assert.equal(result.reason, 'no-changed-files');
    assert.equal(refresh.seen.length, 0);
  });

  it('skips when there is no committed baseline to improve on', async () => {
    const result = await run({
      baselineRows: null,
      scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
    });
    assert.equal(result.reason, 'no-baseline');
  });

  it('skips when the scorer produced nothing', async () => {
    const result = await run({
      baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
      scored: [],
    });
    assert.equal(result.reason, 'no-scored-rows');
  });

  it('restores the baseline file when the commit is rejected', async () => {
    const git = makeGit({ commitFails: true });
    await assert.rejects(
      run({
        baselineRows: [{ path: '.agents/scripts/lib/a.js', mi: 70 }],
        scored: [{ path: '.agents/scripts/lib/a.js', mi: 78 }],
        git,
      }),
      /commitlint rejected/,
    );
    assert.deepEqual(git.argvFor('checkout')[0], [
      'checkout',
      '--',
      'baselines/maintainability.json',
    ]);
  });

  it('rejects a call missing the branch pair rather than guessing one', async () => {
    await assert.rejects(
      runBaselineUpwardWriteback({ cwd: '/repo', storyBranch: 'story-5224' }),
      /baseBranch is required/,
    );
    await assert.rejects(
      runBaselineUpwardWriteback({ cwd: '/repo', baseBranch: 'main' }),
      /storyBranch is required/,
    );
    await assert.rejects(runBaselineUpwardWriteback({}), /cwd is required/);
  });
});
