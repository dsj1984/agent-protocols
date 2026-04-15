import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import {
  __setGitRunners,
  gitSpawn,
  gitSync,
} from '../../.agents/scripts/lib/git-utils.js';

// Restore real git runners after this suite so any later test in the same
// worker process is not contaminated by the mocks installed below.
after(() => __setGitRunners(execFileSync, spawnSync));

describe('git-utils — explicit cwd is forwarded to the child process', () => {
  it('gitSync passes cwd through to execFileSync', () => {
    let observed = null;
    __setGitRunners(
      (_cmd, _args, opts) => {
        observed = opts.cwd;
        return 'main\n';
      },
      () => ({ status: 0, stdout: '', stderr: '' }),
    );

    const result = gitSync('/tmp/worktree-A', 'branch', '--show-current');
    assert.equal(result, 'main');
    assert.equal(observed, '/tmp/worktree-A');
  });

  it('gitSpawn passes cwd through to spawnSync', () => {
    let observed = null;
    __setGitRunners(
      () => '',
      (_cmd, _args, opts) => {
        observed = opts.cwd;
        return { status: 0, stdout: 'ok\n', stderr: '' };
      },
    );

    const result = gitSpawn('/tmp/worktree-B', 'status', '--porcelain');
    assert.equal(result.status, 0);
    assert.equal(observed, '/tmp/worktree-B');
  });

  it('two distinct cwds produce two distinct subprocess invocations', () => {
    const observed = [];
    __setGitRunners(
      (_cmd, _args, opts) => {
        observed.push(opts.cwd);
        return '';
      },
      () => ({ status: 0, stdout: '', stderr: '' }),
    );

    gitSync('/tmp/worktree-X', 'rev-parse', 'HEAD');
    gitSync('/tmp/worktree-Y', 'rev-parse', 'HEAD');

    assert.deepEqual(observed, ['/tmp/worktree-X', '/tmp/worktree-Y']);
  });
});
