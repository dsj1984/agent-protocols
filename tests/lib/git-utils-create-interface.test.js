import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGitInterface } from '../../.agents/scripts/lib/git-utils.js';

describe('createGitInterface', () => {
  it('gitSync trims stdout from the injected exec', () => {
    const execCalls = [];
    const git = createGitInterface({
      exec: (cmd, args, opts) => {
        execCalls.push({ cmd, args, opts });
        return '  branch-name\n';
      },
    });
    const out = git.gitSync('/repo', 'rev-parse', '--abbrev-ref', 'HEAD');
    assert.equal(out, 'branch-name');
    assert.equal(execCalls.length, 1);
    assert.equal(execCalls[0].cmd, 'git');
    assert.deepEqual(execCalls[0].args, ['rev-parse', '--abbrev-ref', 'HEAD']);
    assert.equal(execCalls[0].opts.cwd, '/repo');
    assert.equal(execCalls[0].opts.shell, false);
  });

  it('gitSpawn normalizes status/stdout/stderr from the injected spawn', () => {
    const git = createGitInterface({
      spawn: () => ({ status: 3, stdout: 'out\n', stderr: 'err\n' }),
    });
    const res = git.gitSpawn('/repo', 'status');
    assert.deepEqual(res, { status: 3, stdout: 'out', stderr: 'err' });
  });

  it('gitSpawn defaults null status to 1 so callers can treat it as failure', () => {
    const git = createGitInterface({
      spawn: () => ({ status: null, stdout: null, stderr: null }),
    });
    const res = git.gitSpawn('/repo', 'status');
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, '');
  });

  it('gitFetchWithRetry retries on packed-refs contention using injected sleep', async () => {
    let call = 0;
    const sleeps = [];
    const git = createGitInterface({
      spawn: () => {
        call++;
        if (call < 3) {
          return {
            status: 1,
            stdout: '',
            stderr: 'fatal: cannot lock ref HEAD',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      jitter: 0,
    });
    const res = await git.gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 0);
    assert.equal(res.attempts, 3);
    assert.deepEqual(sleeps, [250, 500]);
  });

  it('gitFetchWithRetry surfaces non-contention failures on the first attempt', async () => {
    let call = 0;
    const git = createGitInterface({
      spawn: () => {
        call++;
        return {
          status: 128,
          stdout: '',
          stderr: 'fatal: not a git repository',
        };
      },
      sleep: async () => {},
      jitter: 0,
    });
    const res = await git.gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 128);
    assert.equal(res.attempts, 1);
    assert.equal(call, 1);
  });
});
