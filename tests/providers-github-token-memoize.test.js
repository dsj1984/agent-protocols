/**
 * Token memoization regression test.
 *
 * Guards the contract from Epic #553 / Story #560: after the first
 * `gh auth token` resolution, subsequent GitHubProvider constructions must
 * short-circuit via process.env.GITHUB_TOKEN so execSync runs at most once.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const providerModule = await import(
  pathToFileURL(path.join(ROOT, '.agents', 'scripts', 'providers', 'github.js'))
    .href
);
const { GitHubProvider, __setExecSyncForTests } = providerModule;

function makeProvider() {
  return new GitHubProvider({
    owner: 'o',
    repo: 'r',
    projectNumber: null,
    operatorHandle: '@t',
  });
}

describe('GitHubProvider — gh auth token memoization', () => {
  let savedGithubToken;
  let savedGhToken;
  let execCalls;

  beforeEach(() => {
    savedGithubToken = process.env.GITHUB_TOKEN;
    savedGhToken = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    execCalls = [];
    __setExecSyncForTests((cmd) => {
      execCalls.push(cmd);
      return 'ghp_fake_cli_token\n';
    });
  });

  afterEach(() => {
    __setExecSyncForTests(null);
    if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedGithubToken;
    if (savedGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedGhToken;
  });

  it('invokes execSync exactly once across 3 sequential provider constructions', () => {
    const p1 = makeProvider();
    const t1 = p1.token;
    const p2 = makeProvider();
    const t2 = p2.token;
    const p3 = makeProvider();
    const t3 = p3.token;

    assert.equal(execCalls.length, 1, 'execSync should run exactly once');
    assert.equal(t1, 'ghp_fake_cli_token');
    assert.equal(t2, 'ghp_fake_cli_token');
    assert.equal(t3, 'ghp_fake_cli_token');
    assert.equal(process.env.GITHUB_TOKEN, 'ghp_fake_cli_token');
  });

  it('never overwrites an operator-supplied GITHUB_TOKEN', () => {
    process.env.GITHUB_TOKEN = 'operator-supplied';
    const p = makeProvider();
    assert.equal(p.token, 'operator-supplied');
    assert.equal(execCalls.length, 0);
    assert.equal(process.env.GITHUB_TOKEN, 'operator-supplied');
  });
});
