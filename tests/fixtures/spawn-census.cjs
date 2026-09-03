// tests/fixtures/spawn-census.cjs
//
// Child-process census preload (Story #5121).
//
// The suite's child-process budget was hand-rolled twice during the
// performance audit (Stories #5109-#5112) and lost both times with the
// gitignored temp tree. This makes it a committed, repeatable instrument.
//
// Usage:
//   npm run test:census              # writes temp/census.json
//   SPAWN_CENSUS_OUT=x.json npm run test:census
//
// Without SPAWN_CENSUS_OUT the preload is inert, so it is safe to leave in
// NODE_OPTIONS.
//
// ## Why a `.cjs` preload, and why the path MUST be absolute
//
// `--require` only accepts CommonJS. It is inherited through NODE_OPTIONS by
// every `node` descendant, which is the point: `npm test` forks one process per
// test file, and the spawns worth counting happen inside those leaves.
//
// That inheritance is also the trap. A **relative** `--require ./tests/...`
// resolves against each process's own cwd, and the suite spawns many children
// with `cwd` set to a temp fixture — where the path does not exist, so the child
// dies with `Cannot find module` before running a line. Measured: the relative
// form turns `tests/diagnose-friction.test.js` from 18 pass / 0 fail into
// 3 pass / 15 fail. The `test:census` script therefore interpolates `$PWD`.
// An instrument that changes the run it measures is worse than none.
//
// ## Why NDJSON plus an aggregation pass
//
// ~700 processes cannot safely write one JSON document. Each process appends a
// single line to `<out>.ndjson` — one `appendFileSync` under PIPE_BUF, which
// POSIX makes atomic for O_APPEND — and the ROOT process aggregates into
// `<out>` when it exits. The root identifies itself by the absence of
// SPAWN_CENSUS_ROOT, then sets it so its descendants (which inherit the env)
// know they are not root. The root exits after its children, so the aggregation
// sees every line.
//
// ## The `nodeInSuite` figure
//
// A raw `node` count is dominated by the runner's own fan-out (one spawn per
// test file). The audit's figure — and the Story's bar — is `node` children
// spawned *by test files*. Each record therefore carries its spawning process's
// script basename, and the aggregator counts a `node` spawn as in-suite only
// when its parent is itself a `*.test.js`.

'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.SPAWN_CENSUS_OUT;

// Everything below is declared at the root of the script and the install
// happens in the single guard block at the bottom. A top-level `return` would
// read better, and Node's CommonJS wrapper accepts one, but Biome parses
// `.cjs` without that wrapper and rejects it outright.
const isRoot = OUT ? !process.env.SPAWN_CENSUS_ROOT : false;
const outAbs = OUT ? path.resolve(OUT) : null;
const ndjson = outAbs ? `${outAbs}.ndjson` : null;

/** Which script is doing the spawning — the parent side of each record. */
const selfScript = path.basename(process.argv[1] || 'unknown');

/** binary -> count, and `node:<script>` -> count for node children. */
const counts = Object.create(null);
/** Full argv strings for the standalone `git config user.*` probe. */
const gitConfigArgs = [];

/**
 * Record one spawn. Never throws: a census must not change the outcome of the
 * run it measures.
 *
 * @param {unknown} cmd  The command as passed to child_process.
 * @param {unknown} args Its argument vector, when the API supplies one.
 */
function record(cmd, args) {
  try {
    const raw = typeof cmd === 'string' ? cmd : String(cmd);
    // `exec`/`execSync` take a whole shell line; the binary is its first word.
    const first = raw.trim().split(/\s+/)[0] || raw;
    const bin = path.basename(first).replace(/\.exe$/i, '');
    counts[bin] = (counts[bin] || 0) + 1;

    const argv = Array.isArray(args) ? args.map(String) : [];

    // A node child's identity is its script, not "node".
    if (bin === 'node') {
      const script = argv.find((a) => !a.startsWith('-'));
      if (script) {
        const key = `node:${path.basename(script)}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    // The Story asserts zero *standalone* `git config user.*` spawns. A read
    // probe (`git config user.email`) and a write (`… user.email <value>`) are
    // both recorded; the aggregator reports them separately, because only the
    // write is fixture setup a helper can replace.
    if (
      bin === 'git' &&
      argv[0] === 'config' &&
      /^user\./.test(argv[1] || '')
    ) {
      gitConfigArgs.push(argv.join(' '));
    }
  } catch {
    // Deliberately silent — see the guarantee above.
  }
}

/**
 * Replace `cp[name]` with a counting wrapper that is otherwise
 * indistinguishable from the original.
 *
 * **Own properties must be carried across.** `child_process.exec` and
 * `execFile` each hold a `util.promisify.custom` implementation, and that is
 * what makes `promisify(execFile)(...)` resolve to `{ stdout, stderr }` rather
 * than to a bare stdout string. A naive wrapper drops the symbol, the
 * promisified form silently resolves to a string, and a caller destructuring
 * `{ stdout }` gets `undefined` — measured as one failure in
 * `tests/lib/child-exec.test.js` before this was handled. The custom impl is
 * wrapped in turn so the async path is still counted. Node marks that symbol
 * non-configurable, so it is swapped *inside* the descriptor set rather than
 * redefined afterwards.
 *
 * @param {string} name Export on `node:child_process` to instrument.
 * @param {(cmd: unknown, args: unknown) => void} onCall Receives the raw call.
 */
function instrument(name, onCall) {
  const original = cp[name];
  if (typeof original !== 'function') return;

  const wrapper = function instrumented(...callArgs) {
    onCall(callArgs[0], callArgs[1]);
    return original.apply(this, callArgs);
  };

  const descriptors = Object.getOwnPropertyDescriptors(original);
  const custom = Object.getOwnPropertySymbols(original).find(
    (s) => s.toString() === 'Symbol(nodejs.util.promisify.custom)',
  );
  if (custom && typeof original[custom] === 'function') {
    const originalCustom = original[custom];
    descriptors[custom] = {
      ...descriptors[custom],
      value: function instrumentedCustom(...callArgs) {
        onCall(callArgs[0], callArgs[1]);
        return originalCustom.apply(this, callArgs);
      },
    };
  }
  Object.defineProperties(wrapper, descriptors);

  cp[name] = wrapper;
}

/** Fold every process's line into one document at `<out>`. */
function aggregate() {
  let lines = [];
  try {
    lines = fs
      .readFileSync(ndjson, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return;
  }

  const byBinary = Object.create(null);
  const byNodeScript = Object.create(null);
  const gitConfigUserSpawns = [];
  let nodeInSuite = 0;
  let nodeTotal = 0;

  for (const rec of lines) {
    const parentIsTest = /\.test\.(c|m)?js$/.test(rec.parent || '');
    for (const [key, n] of Object.entries(rec.counts || {})) {
      if (key.startsWith('node:')) {
        const script = key.slice(5);
        byNodeScript[script] = (byNodeScript[script] || 0) + n;
        continue;
      }
      byBinary[key] = (byBinary[key] || 0) + n;
      if (key === 'node') {
        nodeTotal += n;
        if (parentIsTest) nodeInSuite += n;
      }
    }
    for (const a of rec.gitConfigArgs || []) gitConfigUserSpawns.push(a);
  }

  // `git config user.email` reads a value; `… user.email <value>` writes one.
  // Only the write is fixture setup that a helper can replace, so the two are
  // reported apart — conflating them reads as regression where none exists.
  const writes = gitConfigUserSpawns.filter((a) => a.split(' ').length > 2);

  const report = {
    schema: 'spawn-census/v1',
    generatedAt: new Date().toISOString(),
    processes: lines.length,
    totals: {
      nodeInSuite,
      nodeTotal,
      git: byBinary.git || 0,
      npm: byBinary.npm || 0,
      gh: byBinary.gh || 0,
      gitConfigUserWrites: writes.length,
      gitConfigUserReads: gitConfigUserSpawns.length - writes.length,
    },
    byBinary,
    byNodeScript,
    gitConfigUserSpawns,
  };
  fs.writeFileSync(outAbs, `${JSON.stringify(report, null, 2)}\n`);
}

/** Patch every child_process entry point and arrange the write-out. */
function installCensus() {
  // The per-process log is append-only, so a second run would fold its lines
  // into the first run's and double every count. The root truncates on the way
  // in — two consecutive runs are asked to agree, which appending defeats.
  if (isRoot) {
    try {
      fs.mkdirSync(path.dirname(ndjson), { recursive: true });
      fs.writeFileSync(ndjson, '');
    } catch {
      // A census must never fail the run it measures.
    }
  }

  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    instrument(name, (cmd, args) => record(cmd, args));
  }
  // `exec`/`execSync` take one shell string; there is no argv to read.
  for (const name of ['exec', 'execSync']) {
    instrument(name, (cmd) => record(cmd, []));
  }

  process.on('exit', () => {
    try {
      if (Object.keys(counts).length > 0 || gitConfigArgs.length > 0) {
        fs.mkdirSync(path.dirname(ndjson), { recursive: true });
        fs.appendFileSync(
          ndjson,
          `${JSON.stringify({ parent: selfScript, counts, gitConfigArgs })}\n`,
        );
      }
      if (isRoot) aggregate();
    } catch {
      // Never fail the run being measured.
    }
  });
}

if (OUT) {
  process.env.SPAWN_CENSUS_ROOT =
    process.env.SPAWN_CENSUS_ROOT || String(process.pid);
  installCensus();
}
