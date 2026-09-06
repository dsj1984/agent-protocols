import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  anyChangedUnderTargets,
  COVERAGE_TIMEOUT_EXIT_CODE,
  captureStampPath,
  computeContentDigest,
  describeFreshness,
  filterFilesUnderTargets,
  isCoverageFresh,
  newestSourceMtime,
  runCapture,
  writeCaptureStamp,
} from '../../.agents/scripts/lib/coverage-capture.js';

// `path.resolve` is platform-specific (Windows prepends a drive letter when
// fed a leading-`/` path). Build fixture keys via `path.resolve` so the
// stubs receive whatever shape the production helper actually produces.
const FAKE_REPO = path.resolve('/repo');
const repoPath = (...segs) => path.resolve(FAKE_REPO, ...segs);
const norm = (p) => String(p).replace(/\\/g, '/');

/**
 * Tests for the coverage-capture helper used by close-validation's pre-flight
 * gate and the pre-push hook. The helper is the only pre-CRAP gate guarantee
 * that `coverage/coverage-final.json` exists and is at least as new as the
 * sources the CRAP scorer is about to read — so the freshness predicate has
 * to be exercised against the same `mtime` shape the production code sees.
 */

function makeFsStub({ files, dirs }) {
  // Normalise both the fixture map and the inputs so Windows/POSIX path
  // separators do not disagree.
  const fileMap = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [norm(k), v]),
  );
  const dirMap = Object.fromEntries(
    Object.entries(dirs).map(([k, v]) => [norm(k), v]),
  );
  return {
    statSync(abs) {
      const key = norm(abs);
      if (Object.hasOwn(fileMap, key)) {
        return { mtimeMs: fileMap[key] };
      }
      throw new Error(`ENOENT: ${key}`);
    },
    readdirSync(abs) {
      const key = norm(abs);
      const entries = dirMap[key] ?? [];
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: () => entry.kind === 'dir',
        isFile: () => entry.kind === 'file',
      }));
    },
    existsSync(abs) {
      const key = norm(abs);
      return Object.hasOwn(fileMap, key);
    },
  };
}

describe('newestSourceMtime', () => {
  it('returns the newest scorable-source mtime under any target dir', () => {
    const fs = makeFsStub({
      files: {
        [repoPath('src/a.js')]: 100,
        [repoPath('src/nested/b.mjs')]: 500,
        [repoPath('src/c.txt')]: 9999, // ignored — not a scorable source
        [repoPath('lib/d.js')]: 200,
      },
      dirs: {
        [repoPath('src')]: [
          { name: 'a.js', kind: 'file' },
          { name: 'nested', kind: 'dir' },
          { name: 'c.txt', kind: 'file' },
        ],
        [repoPath('src/nested')]: [{ name: 'b.mjs', kind: 'file' }],
        [repoPath('lib')]: [{ name: 'd.js', kind: 'file' }],
      },
    });
    const result = newestSourceMtime(FAKE_REPO, ['src', 'lib'], fs);
    assert.equal(result, 500);
  });

  it('walks TypeScript sources, not just .js/.mjs (Story #5076)', () => {
    const fs = makeFsStub({
      files: {
        [repoPath('src/a.ts')]: 100,
        [repoPath('src/b.tsx')]: 700,
        [repoPath('src/c.mts')]: 300,
        [repoPath('src/d.cts')]: 200,
        [repoPath('src/e.cjs')]: 150,
        [repoPath('src/page.astro')]: 9999, // the engines cannot score it
      },
      dirs: {
        [repoPath('src')]: [
          { name: 'a.ts', kind: 'file' },
          { name: 'b.tsx', kind: 'file' },
          { name: 'c.mts', kind: 'file' },
          { name: 'd.cts', kind: 'file' },
          { name: 'e.cjs', kind: 'file' },
          { name: 'page.astro', kind: 'file' },
        ],
      },
    });
    assert.equal(newestSourceMtime(FAKE_REPO, ['src'], fs), 700);
  });

  it('skips node_modules and dotfiles', () => {
    const fs = makeFsStub({
      files: {
        [repoPath('src/a.js')]: 100,
        [repoPath('src/node_modules/big.js')]: 9999,
        [repoPath('src/.cache/x.js')]: 9999,
      },
      dirs: {
        [repoPath('src')]: [
          { name: 'a.js', kind: 'file' },
          { name: 'node_modules', kind: 'dir' },
          { name: '.cache', kind: 'dir' },
        ],
      },
    });
    const result = newestSourceMtime(FAKE_REPO, ['src'], fs);
    assert.equal(result, 100);
  });

  it('returns 0 when no sources exist', () => {
    const fs = makeFsStub({ files: {}, dirs: {} });
    const result = newestSourceMtime(FAKE_REPO, ['src'], fs);
    assert.equal(result, 0);
  });
});

describe('isCoverageFresh', () => {
  const targetDirs = ['src'];
  const cwd = FAKE_REPO;
  const coveragePath = 'coverage/coverage-final.json';

  it("flags 'missing' when the artifact is absent", () => {
    const fs = makeFsStub({
      files: { [repoPath('src/a.js')]: 100 },
      dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
    });
    const r = isCoverageFresh({ coveragePath, targetDirs, cwd, ...fs });
    assert.deepEqual(r, { fresh: false, reason: 'missing' });
  });

  it("flags 'fresh' when the artifact is newer than the newest source", () => {
    const fs = makeFsStub({
      files: {
        [repoPath('coverage/coverage-final.json')]: 1000,
        [repoPath('src/a.js')]: 100,
      },
      dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
    });
    const r = isCoverageFresh({ coveragePath, targetDirs, cwd, ...fs });
    assert.deepEqual(r, { fresh: true, reason: 'fresh' });
  });

  it("flags 'stale' when a source has been modified after the artifact", () => {
    const fs = makeFsStub({
      files: {
        [repoPath('coverage/coverage-final.json')]: 100,
        [repoPath('src/a.js')]: 500,
      },
      dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
    });
    const r = isCoverageFresh({ coveragePath, targetDirs, cwd, ...fs });
    assert.deepEqual(r, { fresh: false, reason: 'stale' });
  });

  it("fails closed with 'no-sources' when discovery finds nothing (Story #5076)", () => {
    // "The walk found no source" is an absence of evidence, not a freshness
    // guarantee: trusting it silently disabled the capture — and with it the
    // CRAP gate — for every tree the selector could not see.
    const fs = makeFsStub({
      files: { [repoPath('coverage/coverage-final.json')]: 100 },
      dirs: {},
    });
    const r = isCoverageFresh({ coveragePath, targetDirs, cwd, ...fs });
    assert.deepEqual(r, { fresh: false, reason: 'no-sources' });
  });

  it('sees TypeScript sources, so a TS consumer is not permanently fresh (Story #5076)', () => {
    // The regression that filed #5075: a `js|mjs`-only selector matched
    // nothing in a TS tree, so this returned fresh and no capture ever ran.
    const fs = makeFsStub({
      files: {
        [repoPath('coverage/coverage-final.json')]: 100,
        [repoPath('src/a.ts')]: 500,
        [repoPath('src/Component.tsx')]: 400,
      },
      dirs: {
        [repoPath('src')]: [
          { name: 'a.ts', kind: 'file' },
          { name: 'Component.tsx', kind: 'file' },
        ],
      },
    });
    const r = isCoverageFresh({ coveragePath, targetDirs, cwd, ...fs });
    assert.deepEqual(r, { fresh: false, reason: 'stale' });
  });

  describe('content-digest stamp (Story #3982)', () => {
    const stampAbs = captureStampPath(cwd, coveragePath);
    // Artifact mtime OLDER than the source — the mtime heuristic would say
    // 'stale'. The digest must override it.
    const baseFs = () =>
      makeFsStub({
        files: {
          [repoPath('coverage/coverage-final.json')]: 100,
          [stampAbs]: 100,
          [repoPath('src/a.js')]: 500,
        },
        dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
      });
    const stampJson = JSON.stringify({ digest: 'abc123' });

    it('is fresh on digest match even when mtimes say stale', () => {
      const r = isCoverageFresh({
        coveragePath,
        targetDirs,
        cwd,
        ...baseFs(),
        readFileSync: () => stampJson,
        computeDigest: () => 'abc123',
      });
      assert.deepEqual(r, { fresh: true, reason: 'fresh' });
    });

    it('is stale on digest mismatch even when mtimes say fresh', () => {
      const fs = makeFsStub({
        files: {
          [repoPath('coverage/coverage-final.json')]: 1000,
          [stampAbs]: 1000,
          [repoPath('src/a.js')]: 100,
        },
        dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
      });
      const r = isCoverageFresh({
        coveragePath,
        targetDirs,
        cwd,
        ...fs,
        readFileSync: () => stampJson,
        computeDigest: () => 'different',
      });
      assert.deepEqual(r, { fresh: false, reason: 'stale' });
    });

    it('falls back to the mtime heuristic when the stamp is corrupt', () => {
      const r = isCoverageFresh({
        coveragePath,
        targetDirs,
        cwd,
        ...baseFs(),
        readFileSync: () => 'not-json{',
        computeDigest: () => 'abc123',
      });
      assert.deepEqual(r, { fresh: false, reason: 'stale' });
    });

    it('falls back to the mtime heuristic when the digest is unavailable', () => {
      const r = isCoverageFresh({
        coveragePath,
        targetDirs,
        cwd,
        ...baseFs(),
        readFileSync: () => stampJson,
        computeDigest: () => null,
      });
      assert.deepEqual(r, { fresh: false, reason: 'stale' });
    });

    it('uses the mtime heuristic when no stamp exists (existing contract)', () => {
      const fs = makeFsStub({
        files: {
          [repoPath('coverage/coverage-final.json')]: 1000,
          [repoPath('src/a.js')]: 100,
        },
        dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
      });
      const r = isCoverageFresh({
        coveragePath,
        targetDirs,
        cwd,
        ...fs,
        computeDigest: () => {
          throw new Error('must not compute a digest without a stamp');
        },
      });
      assert.deepEqual(r, { fresh: true, reason: 'fresh' });
    });
  });
});

describe('computeContentDigest', () => {
  const lsFiles = '100644 aaa111 0\tsrc/a.js\n100644 bbb222 0\tsrc/b.mjs\n';
  const makeSpawn =
    ({ ls = lsFiles, status = '' } = {}) =>
    (_cmd, args) => ({
      status: 0,
      stdout: args[0] === 'ls-files' ? ls : status,
    });

  it('is stable across calls for identical content', () => {
    const io = { spawnSync: makeSpawn(), readFileSync: () => '' };
    const d1 = computeContentDigest(FAKE_REPO, ['src'], io);
    const d2 = computeContentDigest(FAKE_REPO, ['src'], io);
    assert.equal(typeof d1, 'string');
    assert.equal(d1, d2);
  });

  it('changes when a tracked blob SHA changes', () => {
    const d1 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn(),
    });
    const d2 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({
        ls: lsFiles.replace('aaa111', 'ccc333'),
      }),
    });
    assert.notEqual(d1, d2);
  });

  it('folds dirty working-tree file bytes into the digest', () => {
    const dirty = ' M src/a.js\n';
    const d1 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({ status: dirty }),
      readFileSync: () => 'content-v1',
    });
    const d2 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({ status: dirty }),
      readFileSync: () => 'content-v2',
    });
    assert.notEqual(d1, d2);
  });

  it('ignores non-source dirty files (e.g. markdown)', () => {
    const d1 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn(),
    });
    const d2 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({ status: ' M src/readme.md\n' }),
      readFileSync: () => 'docs',
    });
    assert.equal(d1, d2);
  });

  it('digests TypeScript sources (Story #5076)', () => {
    const tsLs =
      '100644 aaa111 0\tsrc/a.ts\n100644 bbb222 0\tsrc/Component.tsx\n';
    const d1 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({ ls: tsLs }),
    });
    const d2 = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({ ls: tsLs.replace('aaa111', 'ccc333') }),
    });
    assert.equal(typeof d1, 'string');
    assert.notEqual(d1, d2);
  });

  it('returns null — never a digest of nothing — when no source matches (Story #5076)', () => {
    // The primary freshness path. Hashing an empty file list yields the
    // SHA-256 of the empty string: a real, stable digest that can never go
    // stale, which pins the artifact permanently fresh and makes the mtime
    // path's fail-closed verdict unreachable.
    const SHA256_OF_EMPTY =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const digest = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({
        ls: '100644 aaa111 0\tsrc/page.astro\n100644 bbb222 0\tsrc/readme.md\n',
        status: ' M src/page.astro\n',
      }),
      readFileSync: () => 'markup',
    });
    assert.notEqual(digest, SHA256_OF_EMPTY);
    assert.equal(digest, null);
  });

  it('still digests when only a dirty scorable file exists (Story #5076)', () => {
    // The empty-set guard must key on "no scorable file at all", not on an
    // empty tracked listing: a brand-new untracked source is real evidence.
    const digest = computeContentDigest(FAKE_REPO, ['src'], {
      spawnSync: makeSpawn({ ls: '', status: '?? src/new.ts\n' }),
      readFileSync: () => 'export const a = 1;',
    });
    assert.equal(typeof digest, 'string');
  });

  it('returns null when git fails or target dirs are empty', () => {
    assert.equal(
      computeContentDigest(FAKE_REPO, ['src'], {
        spawnSync: () => ({ status: 128, stdout: '', stderr: 'not a repo' }),
      }),
      null,
    );
    assert.equal(computeContentDigest(FAKE_REPO, [], {}), null);
  });
});

describe('describeFreshness (Story #5076)', () => {
  it('annotates a no-sources verdict with the dirs it walked', () => {
    const line = describeFreshness({ reason: 'no-sources' }, ['src', 'lib']);
    assert.match(line, /^no-sources —/);
    assert.match(line, /\[src, lib\]/);
    assert.match(line, /quality\.gates\.crap\.targetDirs/);
  });

  it('tolerates a missing verdict or dir list rather than throwing', () => {
    // The renderer sits on the capture path's log line; a shape surprise
    // there must not take down the capture it is describing.
    assert.match(
      describeFreshness({ reason: 'no-sources' }, undefined),
      /\[\]/,
    );
    assert.equal(describeFreshness(undefined, ['src']), 'undefined');
  });

  it('passes every self-explaining reason through unchanged', () => {
    for (const reason of ['stale', 'missing', 'fresh', 'scope-mismatch']) {
      assert.equal(describeFreshness({ reason }, ['src']), reason);
    }
  });
});

describe('writeCaptureStamp / captureStampPath', () => {
  it('writes a JSON stamp next to the coverage artifact', () => {
    const writes = [];
    const ok = writeCaptureStamp({
      cwd: FAKE_REPO,
      coveragePath: 'coverage/coverage-final.json',
      digest: 'abc123',
      writeFileSync: (p, body) => writes.push({ p, body }),
    });
    assert.equal(ok, true);
    assert.equal(writes.length, 1);
    assert.equal(
      writes[0].p,
      captureStampPath(FAKE_REPO, 'coverage/coverage-final.json'),
    );
    assert.equal(
      norm(writes[0].p),
      norm(repoPath('coverage/.capture-stamp.json')),
    );
    const parsed = JSON.parse(writes[0].body);
    assert.equal(parsed.digest, 'abc123');
    assert.equal(typeof parsed.capturedAt, 'string');
  });

  it('returns false on an empty digest or a write failure', () => {
    assert.equal(
      writeCaptureStamp({
        cwd: FAKE_REPO,
        coveragePath: 'coverage/coverage-final.json',
        digest: '',
        writeFileSync: () => {},
      }),
      false,
    );
    assert.equal(
      writeCaptureStamp({
        cwd: FAKE_REPO,
        coveragePath: 'coverage/coverage-final.json',
        digest: 'abc',
        writeFileSync: () => {
          throw new Error('EACCES');
        },
      }),
      false,
    );
  });
});

describe('anyChangedUnderTargets', () => {
  it('returns true when a changed file lives directly under a target', () => {
    assert.equal(
      anyChangedUnderTargets(['src/a.js', 'README.md'], ['src']),
      true,
    );
  });

  it('returns true for nested matches', () => {
    assert.equal(anyChangedUnderTargets(['src/lib/x.js'], ['src']), true);
  });

  it('returns false when no changes touch a target dir', () => {
    assert.equal(
      anyChangedUnderTargets(['docs/x.md', 'README.md'], ['src']),
      false,
    );
  });

  it('returns false on empty inputs', () => {
    assert.equal(anyChangedUnderTargets([], ['src']), false);
    assert.equal(anyChangedUnderTargets(['src/a.js'], []), false);
  });

  it('normalises Windows-style separators in changed files', () => {
    assert.equal(anyChangedUnderTargets(['src\\lib\\x.js'], ['src']), true);
  });

  it('does not match a different dir that shares a prefix', () => {
    // `srcs/` must not match `src` even though the prefix lines up.
    assert.equal(anyChangedUnderTargets(['srcs/foo.js'], ['src']), false);
  });
});

describe('runCapture', () => {
  it('spawns `npm run test:coverage` with inherited stdio', () => {
    const calls = [];
    const runner = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };
    const code = runCapture({ cwd: '/repo', runner });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'npm');
    assert.deepEqual(calls[0].args, ['run', 'test:coverage']);
    assert.equal(calls[0].opts.cwd, '/repo');
    assert.equal(calls[0].opts.stdio, 'inherit');
  });

  it('returns the runner status (1 when the suite fails)', () => {
    const runner = () => ({ status: 1 });
    assert.equal(runCapture({ cwd: '/repo', runner }), 1);
  });

  it('coerces an undefined status to 1 so callers fail closed', () => {
    const runner = () => ({ status: undefined });
    assert.equal(runCapture({ cwd: '/repo', runner }), 1);
  });

  it('threads a positive timeoutMs as `timeout` + killSignal: SIGKILL', () => {
    const calls = [];
    const runner = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };
    runCapture({ cwd: '/repo', timeoutMs: 600_000, runner });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.timeout, 600_000);
    assert.equal(calls[0].opts.killSignal, 'SIGKILL');
  });

  it('omits the `timeout` option when timeoutMs is missing or non-positive', () => {
    const calls = [];
    const runner = (_cmd, _args, opts) => {
      calls.push(opts);
      return { status: 0 };
    };
    runCapture({ cwd: '/repo', runner });
    runCapture({ cwd: '/repo', timeoutMs: 0, runner });
    runCapture({ cwd: '/repo', timeoutMs: -1, runner });
    runCapture({ cwd: '/repo', timeoutMs: 'nope', runner });
    for (const opts of calls) {
      assert.equal(
        Object.hasOwn(opts, 'timeout'),
        false,
        'timeout must not be set when timeoutMs is unset/invalid',
      );
      assert.equal(opts.killSignal, 'SIGKILL');
    }
  });

  it('returns 124 when the runner reports SIGKILL (simulating a timeout)', () => {
    const runner = () => ({ status: null, signal: 'SIGKILL' });
    const logs = [];
    const code = runCapture({
      cwd: '/repo',
      timeoutMs: 100,
      runner,
      log: (m) => logs.push(m),
    });
    assert.equal(code, COVERAGE_TIMEOUT_EXIT_CODE);
    assert.equal(code, 124);
    assert.ok(
      logs.some((m) => /exceeded 100ms/.test(m)),
      'expected a timeout-trip log entry',
    );
  });

  // Story #5173 — `runCapture` deliberately stays a pure spawn helper: the
  // host lock is composed OVER it by `lockedCapture` (full-suite-lock.js) at
  // the CLI's one production call site, so the pre-push and unit-test callers
  // reaching it directly spawn unserialized with no flag to pass. What that
  // buys is pinned in tests/lib/full-suite-lock.test.js.

  // Story #5065 — the spawn takes NO positional file arguments. Story #4981
  // appended `-- <files...>` believing a test runner would read them as
  // filters over the suite; Node's runner executes each path as a test file,
  // so a forwarded source file runs as a trivially-passing test and the real
  // suite never runs. `run-coverage.js` discarded the list, which is the only
  // reason it never bit. The argv is pinned here so the plumbing cannot come
  // back by way of an `opts.files` that looks harmless.
  describe('no positional file scope (Story #5065)', () => {
    it('spawns the bare `npm run test:coverage` argv, whatever opts are passed', () => {
      const calls = [];
      const runner = (cmd, args) => {
        calls.push({ cmd, args });
        return { status: 0 };
      };
      runCapture({ cwd: '/repo', runner });
      runCapture({ cwd: '/repo', runner, files: ['src/a.js', 'src/b.js'] });
      runCapture({ cwd: '/repo', runner, files: [] });
      for (const call of calls) {
        assert.equal(call.cmd, 'npm');
        assert.deepEqual(
          call.args,
          ['run', 'test:coverage'],
          'the capture spawn must never carry positional file arguments',
        );
      }
    });
  });
});

describe('filterFilesUnderTargets', () => {
  it('narrows to the files under the given target dirs, normalising separators', () => {
    assert.deepEqual(
      filterFilesUnderTargets(
        ['src/a.js', 'src\\lib\\x.js', 'README.md', 'docs/x.md'],
        ['src'],
      ),
      ['src/a.js', 'src/lib/x.js'],
    );
  });

  it('returns [] on empty inputs', () => {
    assert.deepEqual(filterFilesUnderTargets([], ['src']), []);
    assert.deepEqual(filterFilesUnderTargets(['src/a.js'], []), []);
  });
});

describe('writeCaptureStamp — incremental scope (Story #4981)', () => {
  it('AC-4/AC-1: writes scope, files, and ref only when scope is supplied', () => {
    const writes = [];
    writeCaptureStamp({
      cwd: FAKE_REPO,
      coveragePath: 'coverage/coverage-final.json',
      digest: 'abc123',
      scope: 'incremental',
      files: ['src/b.js', 'src/a.js'],
      ref: 'main',
      writeFileSync: (p, body) => writes.push({ p, body }),
    });
    const parsed = JSON.parse(writes[0].body);
    assert.equal(parsed.scope, 'incremental');
    // Sorted for a deterministic on-disk stamp.
    assert.deepEqual(parsed.files, ['src/a.js', 'src/b.js']);
    assert.equal(parsed.ref, 'main');
  });

  it('AC-5: omitting scope reproduces the exact pre-#4981 stamp shape', () => {
    const writes = [];
    writeCaptureStamp({
      cwd: FAKE_REPO,
      coveragePath: 'coverage/coverage-final.json',
      digest: 'abc123',
      writeFileSync: (p, body) => writes.push({ p, body }),
    });
    const parsed = JSON.parse(writes[0].body);
    assert.deepEqual(Object.keys(parsed).sort(), ['capturedAt', 'digest']);
  });
});

describe('isCoverageFresh — scope asymmetry (Story #4981, AC-4)', () => {
  const targetDirs = ['src'];
  const cwd = FAKE_REPO;
  const coveragePath = 'coverage/coverage-final.json';
  const stampAbs = captureStampPath(cwd, coveragePath);
  const baseFs = () =>
    makeFsStub({
      files: {
        [repoPath('coverage/coverage-final.json')]: 1000,
        [stampAbs]: 1000,
        [repoPath('src/a.js')]: 100,
      },
      dirs: { [repoPath('src')]: [{ name: 'a.js', kind: 'file' }] },
    });

  it('a scoped (incremental) stamp does NOT satisfy the default full-scope probe', () => {
    const stampJson = JSON.stringify({
      digest: 'abc123',
      scope: 'incremental',
    });
    const r = isCoverageFresh({
      coveragePath,
      targetDirs,
      cwd,
      ...baseFs(),
      readFileSync: () => stampJson,
      computeDigest: () => 'abc123',
    });
    assert.deepEqual(r, { fresh: false, reason: 'scope-mismatch' });
  });

  it('a scoped (incremental) stamp DOES satisfy an incremental probe on digest match', () => {
    const stampJson = JSON.stringify({
      digest: 'abc123',
      scope: 'incremental',
    });
    const r = isCoverageFresh({
      coveragePath,
      targetDirs,
      cwd,
      requireScope: 'incremental',
      ...baseFs(),
      readFileSync: () => stampJson,
      computeDigest: () => 'abc123',
    });
    assert.deepEqual(r, { fresh: true, reason: 'fresh' });
  });

  it('a full-scope stamp satisfies an incremental probe on digest match (asymmetric)', () => {
    const stampJson = JSON.stringify({ digest: 'abc123', scope: 'full' });
    const r = isCoverageFresh({
      coveragePath,
      targetDirs,
      cwd,
      requireScope: 'incremental',
      ...baseFs(),
      readFileSync: () => stampJson,
      computeDigest: () => 'abc123',
    });
    assert.deepEqual(r, { fresh: true, reason: 'fresh' });
  });

  it('a legacy stamp with no scope field behaves as full-scope (AC-5 back-compat)', () => {
    const stampJson = JSON.stringify({ digest: 'abc123' });
    const r = isCoverageFresh({
      coveragePath,
      targetDirs,
      cwd,
      ...baseFs(),
      readFileSync: () => stampJson,
      computeDigest: () => 'abc123',
    });
    assert.deepEqual(r, { fresh: true, reason: 'fresh' });
  });
});
