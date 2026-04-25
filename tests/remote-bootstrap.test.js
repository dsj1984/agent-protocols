import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  buildAuthenticatedCloneUrl,
  buildLaunchInvocation,
  PHASE_TO_COMMAND,
  parsePhaseFromArgv,
  resolveCloneTarget,
  resolvePhase,
} from '../.agents/scripts/remote-bootstrap.js';

test('parsePhaseFromArgv: returns the value after --phase', () => {
  assert.equal(parsePhaseFromArgv(['--phase', 'spec']), 'spec');
});

test('parsePhaseFromArgv: handles --phase=value form', () => {
  assert.equal(parsePhaseFromArgv(['--phase=decompose']), 'decompose');
});

test('parsePhaseFromArgv: missing flag returns undefined', () => {
  assert.equal(parsePhaseFromArgv([]), undefined);
});

test('parsePhaseFromArgv: throws when --phase has no value', () => {
  assert.throws(() => parsePhaseFromArgv(['--phase']), /requires a value/);
  assert.throws(() => parsePhaseFromArgv(['--phase', '--foo']), /requires/);
});

test('resolvePhase: argv beats env', () => {
  assert.equal(
    resolvePhase({ argv: ['--phase', 'spec'], env: { PHASE: 'execute' } }),
    'spec',
  );
});

test('resolvePhase: defaults to execute', () => {
  assert.equal(resolvePhase({ argv: [], env: {} }), 'execute');
});

test('resolvePhase: env fallback when argv missing', () => {
  assert.equal(resolvePhase({ argv: [], env: { PHASE: 'decompose' } }), 'decompose');
});

test('resolvePhase: rejects unknown phase', () => {
  assert.throws(() => resolvePhase({ argv: [], env: { PHASE: 'plan' } }), /Unknown --phase/);
});

test('resolveCloneTarget: prefers REPO_URL', () => {
  const out = resolveCloneTarget({
    REPO_URL: 'https://example.com/foo.git',
    GITHUB_REPOSITORY: 'a/b',
  });
  assert.equal(out.ok, true);
  assert.equal(out.repoUrl, 'https://example.com/foo.git');
  assert.equal(out.ref, 'main');
});

test('resolveCloneTarget: derives URL from GITHUB_REPOSITORY', () => {
  const out = resolveCloneTarget({ GITHUB_REPOSITORY: 'me/repo' });
  assert.equal(out.repoUrl, 'https://github.com/me/repo.git');
});

test('resolveCloneTarget: returns failure when neither var is present', () => {
  const out = resolveCloneTarget({});
  assert.equal(out.ok, false);
  assert.match(out.reason, /REPO_URL or GITHUB_REPOSITORY/);
});

test('resolveCloneTarget: respects WORKSPACE_DIR + REPO_REF overrides', () => {
  const out = resolveCloneTarget({
    GITHUB_REPOSITORY: 'me/repo',
    WORKSPACE_DIR: 'custom-ws',
    REPO_REF: 'develop',
  });
  assert.equal(out.workspace, resolve('custom-ws'));
  assert.equal(out.ref, 'develop');
});

test('buildAuthenticatedCloneUrl: injects token as x-access-token', () => {
  assert.equal(
    buildAuthenticatedCloneUrl('https://github.com/x/y.git', 'TOKEN'),
    'https://x-access-token:TOKEN@github.com/x/y.git',
  );
});

test('buildLaunchInvocation: execute → /sprint-execute', () => {
  const out = buildLaunchInvocation({ phase: 'execute', epicId: 42 });
  assert.equal(out.bin, 'claude');
  assert.deepEqual(out.args, ['/sprint-execute', '42']);
});

test('buildLaunchInvocation: spec → /sprint-plan --phase spec', () => {
  const out = buildLaunchInvocation({
    phase: 'spec',
    epicId: 7,
    claudeBin: '/usr/bin/claude',
  });
  assert.equal(out.bin, '/usr/bin/claude');
  assert.deepEqual(out.args, ['/sprint-plan', '--phase', 'spec', '7']);
});

test('PHASE_TO_COMMAND is frozen and complete', () => {
  assert.throws(() => {
    PHASE_TO_COMMAND.spec = 'changed';
  });
  assert.deepEqual(Object.keys(PHASE_TO_COMMAND).sort(), [
    'decompose',
    'execute',
    'spec',
  ]);
});
