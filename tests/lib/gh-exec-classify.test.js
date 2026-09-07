import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import exec, {
  classify,
  describeGhFailure,
  GhAuthError,
  GhExecError,
  GhGraphqlError,
  GhNotFoundError,
  GhNotInstalledError,
  GhRateLimitError,
  GhScopeError,
} from '../../.agents/scripts/lib/gh-exec.js';

/**
 * Drive a fake child that exits with the given (code, stderr) so we can
 * assert end-to-end that exec() routes non-zero exits through classify().
 */
function makeFakeSpawn({
  stdout = '',
  stderr = '',
  code = 1,
  signal = null,
} = {}) {
  const fake = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr, 'utf8'));
      child.emit('close', code, signal);
    });
    return child;
  };
  return fake;
}

describe('gh-exec classify() — direct pattern matching', () => {
  it('ENOENT spawn errors map to GhNotInstalledError', () => {
    const err = classify({
      spawnError: Object.assign(new Error('spawn gh ENOENT'), {
        code: 'ENOENT',
      }),
      args: ['issue', 'view', '1'],
    });
    assert.ok(err instanceof GhNotInstalledError);
    assert.ok(err instanceof GhExecError); // base-class instanceof must hold
  });

  it('"command requires authentication" maps to GhAuthError', () => {
    const err = classify({
      stderr:
        'gh: To get started with GitHub CLI, please run: gh auth login.\nThe command requires authentication.\n',
      code: 4,
      args: ['issue', 'list'],
    });
    assert.ok(err instanceof GhAuthError);
    assert.equal(err.stderr.includes('authentication'), true);
  });

  it('"missing required scope" maps to GhScopeError', () => {
    const err = classify({
      stderr:
        'gh: Your token has not been granted the required scopes to execute this query.',
      code: 1,
      args: ['api', 'graphql', '-f', 'query=...'],
    });
    assert.ok(err instanceof GhScopeError);
  });

  it('HTTP 404 maps to GhNotFoundError', () => {
    const err = classify({
      stderr: 'gh: HTTP 404: Not Found (https://api.github.com/repos/foo/bar)',
      code: 1,
      args: ['issue', 'view', '9999'],
    });
    assert.ok(err instanceof GhNotFoundError);
  });

  it('secondary rate limit maps to GhRateLimitError', () => {
    const err = classify({
      stderr:
        'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      code: 1,
      args: ['api', '/rate_limit'],
    });
    assert.ok(err instanceof GhRateLimitError);
  });

  it('GraphQL errors map to GhGraphqlError', () => {
    const err = classify({
      stderr: 'GraphQL: Field "foo" doesn\'t exist on type "Issue" (data)',
      code: 1,
      args: ['api', 'graphql', '-f', 'query=...'],
    });
    assert.ok(err instanceof GhGraphqlError);
  });

  it('Generic non-zero exits fall through to GhExecError', () => {
    const err = classify({
      stderr: 'something unexpected went sideways',
      code: 7,
      args: ['repo', 'view'],
    });
    assert.equal(err.constructor.name, 'GhExecError');
    assert.ok(err instanceof GhExecError);
    assert.equal(err.code, 7);
    assert.equal(err.stderr, 'something unexpected went sideways');
  });

  it('Every thrown error carries {args, code, stderr}', () => {
    const err = classify({
      stderr: 'HTTP 404: Not Found',
      code: 1,
      args: ['issue', 'view', '99'],
    });
    assert.deepEqual(err.args, ['issue', 'view', '99']);
    assert.equal(err.code, 1);
    assert.equal(err.stderr, 'HTTP 404: Not Found');
  });
});

describe('gh-exec exec() — non-zero exit routing', () => {
  it('routes non-zero exits through classify()', async () => {
    const fake = makeFakeSpawn({
      stderr: 'gh: HTTP 404: Not Found',
      code: 1,
    });
    await assert.rejects(
      exec({ args: ['issue', 'view', '99'], spawnImpl: fake }),
      (err) => err instanceof GhNotFoundError,
    );
  });

  it('does not parse JSON when exit code is non-zero (error path wins)', async () => {
    // Even when --json is present, a non-zero exit must not try to parse.
    const fake = makeFakeSpawn({
      stdout: 'not really json',
      stderr: 'gh: command requires authentication',
      code: 4,
    });
    await assert.rejects(
      exec({
        args: ['issue', 'view', '1', '--json', 'number'],
        spawnImpl: fake,
      }),
      (err) => err instanceof GhAuthError,
    );
  });

  it('spawn-time ENOENT surfaces as GhNotInstalledError', async () => {
    const fakeThrows = () => {
      const e = new Error('spawn gh ENOENT');
      e.code = 'ENOENT';
      throw e;
    };
    await assert.rejects(
      exec({ args: ['--version'], spawnImpl: fakeThrows }),
      (err) => err instanceof GhNotInstalledError,
    );
  });
});

describe('describeGhFailure', () => {
  it("appends gh's own last stderr line to the classified message", () => {
    // Story #5201: the classified message keeps only the exit status, so the
    // 422 reason GitHub returned was lost at every degrade site. `gh` puts the
    // actionable sentence last, under the HTTP banner and the API URL.
    const err = new GhExecError('gh-exec: gh exited with code 1', {
      args: ['label', 'create'],
      stderr:
        'HTTP 422: Validation Failed (https://api.github.com/repos/o/r/labels)\n' +
        'description is too long (maximum is 100 characters)\n',
    });
    assert.equal(
      describeGhFailure(err),
      'gh-exec: gh exited with code 1: description is too long (maximum is 100 characters)',
    );
  });

  it('degrades to the bare message when nothing was captured', () => {
    assert.equal(describeGhFailure(new Error('boom')), 'boom');
    assert.equal(
      describeGhFailure(new GhExecError('exit 1', { stderr: '  \n \n' })),
      'exit 1',
      'whitespace-only stderr adds nothing',
    );
  });

  it('is safe on non-Error inputs', () => {
    // Every call site is a catch block, which can receive anything.
    assert.equal(describeGhFailure('a thrown string'), 'a thrown string');
    assert.equal(describeGhFailure(null), 'unknown error');
    assert.equal(describeGhFailure(undefined), 'unknown error');
  });
});
