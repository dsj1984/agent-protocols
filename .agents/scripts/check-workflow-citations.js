/**
 * CLI: ratchet-down gate on provenance citations in workflow prose.
 *
 * Workflow documents ride resident in an executing agent's context. A
 * `(Story #1234)` aside costs the same tokens as instruction and teaches
 * the model Mandrel's own history instead of the task in front of it. The
 * citations that survive are the ones a reader must follow to act; the
 * rest belong in the commit trail and `docs/decisions.md`.
 *
 * Nothing stops the tax re-accumulating one well-meaning aside at a time,
 * so this gate holds the line: count every issue-shaped reference across
 * `.agents/workflows/**\/*.md` and fail when the total rises above the
 * committed baseline at `baselines/workflow-citations.json`.
 *
 * The counted token is the bare `#NNNN` form rather than the
 * `(Story|Epic|issue|refs) #NNNN` phrasing, because the same citation is
 * written both ways — `(Story #4593)` and a bare `(#4593)` — and a gate
 * that only saw the prefixed form would wave the other one through.
 *
 * Ratchet semantics mirror `check-arch-cycles.js`:
 *   - Total above the baseline → exit 1, with the files that grew.
 *   - Total below the baseline → printed as shrinkage, exit 0. Refresh the
 *     baseline with `--update` to lock the reduction in.
 *   - Equal → exit 0.
 *
 * Flags:
 *   --baseline <path>  override the baseline path (default
 *                      `baselines/workflow-citations.json`, resolved from cwd)
 *   --root <path>      scan a different workflow root (default
 *                      `.agents/workflows`)
 *   --update           rewrite the baseline from the live count
 *   --json             write the structured envelope to stdout
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { runAsCli } from './lib/cli-utils.js';

/** Default workflow root, relative to the repository root. */
const DEFAULT_ROOT = path.join('.agents', 'workflows');

/** Default baseline path, relative to the repository root. */
const DEFAULT_BASELINE = path.join('baselines', 'workflow-citations.json');

/**
 * Issue-shaped reference: a `#` followed by 3–5 digits. Narrow enough to
 * skip markdown headings and anchor links, wide enough to catch both the
 * `(Story #1234)` and bare `(#1234)` spellings of one citation.
 */
const CITATION_RE = /#\d{3,5}\b/g;

/**
 * Parse argv. Exported so unit tests can pin the parser.
 *
 * @param {string[]} argv
 * @returns {{ baselinePath: string | null, rootPath: string | null, update: boolean, json: boolean }}
 */
export function parseArgv(argv = []) {
  const out = {
    baselinePath: null,
    rootPath: null,
    update: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    const takesValue = next && !next.startsWith('--');
    if (flag === '--baseline' && takesValue) {
      out.baselinePath = next;
      i += 1;
    } else if (flag === '--root' && takesValue) {
      out.rootPath = next;
      i += 1;
    } else if (flag === '--update') {
      out.update = true;
    } else if (flag === '--json') {
      out.json = true;
    }
  }
  return out;
}

/**
 * Recursively collect `.md` files under `rootDir`. Returns absolute paths,
 * sorted for determinism.
 *
 * @param {string} rootDir
 * @returns {string[]}
 */
export function collectMarkdownFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(rootDir);
  return out.sort();
}

/**
 * Pure helper: count citations in source text.
 *
 * @param {string} source
 * @returns {number}
 */
export function countCitations(source) {
  return (String(source ?? '').match(CITATION_RE) ?? []).length;
}

/**
 * Count citations across a file set, relativizing paths against `cwd` so
 * the report serializes identically on every platform. Files with zero
 * citations are omitted — the baseline records where the tax lives.
 *
 * @param {string[]} files absolute paths
 * @param {string} cwd
 * @param {{ readFile?: (p: string) => string }} [opts]
 * @returns {{ total: number, files: Array<{ path: string, count: number }> }}
 */
export function tallyCitations(files, cwd, { readFile } = {}) {
  const read = readFile ?? ((p) => fs.readFileSync(p, 'utf-8'));
  const rows = [];
  let total = 0;
  for (const file of files) {
    let count;
    try {
      count = countCitations(read(file));
    } catch {
      continue;
    }
    if (count === 0) continue;
    total += count;
    rows.push({
      path: path.relative(cwd, file).split(path.sep).join('/'),
      count,
    });
  }
  return { total, files: rows.sort((a, b) => a.path.localeCompare(b.path)) };
}

/**
 * Pure helper: read the baseline envelope. Returns `null` when the file is
 * missing or unparseable — the baseline is not distributed to consumers, so
 * its absence degrades to "no ceiling" rather than a false failure.
 *
 * @param {string} baselinePath
 * @returns {{ total?: number, files?: Array<{ path: string, count: number }> } | null}
 */
export function loadBaseline(baselinePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pure helper: diff the live tally against the baseline. `grew` names the
 * files whose per-file count rose, so a failure points at the edit rather
 * than only at the total.
 *
 * @param {{ total?: number, files?: Array<{ path: string, count: number }> } | null} baseline
 * @param {{ total: number, files: Array<{ path: string, count: number }> }} tally
 * @returns {{ baselineTotal: number | null, delta: number | null, grew: Array<{ path: string, from: number, to: number }> }}
 */
export function diffTally(baseline, tally) {
  const baselineTotal =
    typeof baseline?.total === 'number' ? baseline.total : null;
  const prior = new Map(
    (baseline?.files ?? []).map((row) => [row.path, row.count]),
  );
  const grew = tally.files
    .map((row) => ({
      path: row.path,
      from: prior.get(row.path) ?? 0,
      to: row.count,
    }))
    .filter((row) => row.to > row.from);
  return {
    baselineTotal,
    delta: baselineTotal === null ? null : tally.total - baselineTotal,
    grew,
  };
}

/**
 * Pure helper: render the human-readable diff, mirroring the `+` / `-`
 * vocabulary of the sibling ratchets.
 *
 * @param {{ baselineTotal: number | null, delta: number | null, grew: Array<{ path: string, from: number, to: number }> }} diff
 * @param {{ total: number }} tally
 * @returns {string}
 */
export function renderDiff(diff, tally) {
  const lines = [];
  for (const row of diff.grew) {
    lines.push(`+ ${row.path}: ${row.from} -> ${row.to}`);
  }
  if (diff.delta !== null && diff.delta < 0) {
    lines.push(
      `[workflow-citations] ⚠ ${-diff.delta} citation(s) below baseline — refresh with --update to lock the reduction in`,
    );
  }
  const tag = diff.delta !== null && diff.delta > 0 ? '(gate fail)' : '(ok)';
  lines.push(
    `[workflow-citations] total=${tally.total} baseline=${diff.baselineTotal ?? 'none'} ${tag}`,
  );
  return lines.join('\n');
}

/**
 * Top-level CLI entry. Exported so tests can drive the pipeline against a
 * tmpdir fixture corpus.
 *
 * @param {{
 *   argv?: string[],
 *   cwd?: string,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 * @returns {Promise<number>} 0 = at or below baseline; 1 = regression
 */
export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const { baselinePath, rootPath, update, json } = parseArgv(argv);
  const root = path.resolve(cwd, rootPath ?? DEFAULT_ROOT);
  const resolvedBaselinePath = path.resolve(
    cwd,
    baselinePath ?? DEFAULT_BASELINE,
  );
  if (!fs.existsSync(root)) {
    throw new Error(`[workflow-citations] workflow root not found: ${root}`);
  }

  const tally = tallyCitations(collectMarkdownFiles(root), cwd);

  if (update) {
    const envelope = {
      $schema: 'https://mandrel.dev/baselines/workflow-citations.schema.json',
      generatedAt: new Date().toISOString(),
      total: tally.total,
      files: tally.files,
    };
    fs.mkdirSync(path.dirname(resolvedBaselinePath), { recursive: true });
    fs.writeFileSync(
      resolvedBaselinePath,
      `${JSON.stringify(envelope, null, 2)}\n`,
    );
    stdout.write(
      `[workflow-citations] baseline written: ${resolvedBaselinePath} (total=${tally.total})\n`,
    );
    return 0;
  }

  const baseline = loadBaseline(resolvedBaselinePath);
  const diff = diffTally(baseline, tally);
  const exitCode = diff.delta !== null && diff.delta > 0 ? 1 : 0;

  if (json) {
    stdout.write(
      `${JSON.stringify(
        {
          kind: 'workflow-citations-report',
          root,
          baselinePath: resolvedBaselinePath,
          total: tally.total,
          baselineTotal: diff.baselineTotal,
          delta: diff.delta,
          files: tally.files,
          grew: diff.grew,
          exitCode,
        },
        null,
        2,
      )}\n`,
    );
    return exitCode;
  }

  if (!baseline) {
    stderr.write(
      `[workflow-citations] ⚠ baseline not found at ${resolvedBaselinePath} — no ceiling enforced\n`,
    );
  }
  stdout.write(`\n--- workflow-citations preview ---\n`);
  stdout.write(`${renderDiff(diff, tally)}\n`);
  return exitCode;
}

async function main() {
  return runCli();
}

runAsCli(import.meta.url, main, {
  source: 'workflow-citations',
  propagateExitCode: true,
  errorPrefix: '[workflow-citations] ❌ Fatal error',
  usage: {
    invocation:
      'node .agents/scripts/check-workflow-citations.js [--baseline <path>] [--root <dir>] [--update] [--json]',
    summary:
      'Ratchet on provenance citations in workflow prose: count issue-shaped references across .agents/workflows/** and fail when the total rises above the recorded baseline.',
    flags: [
      [
        '--baseline <path>',
        'Baseline file (default: baselines/workflow-citations.json).',
      ],
      ['--root <dir>', 'Workflow root to scan (default: .agents/workflows).'],
      ['--update', 'Rewrite the baseline from the live count.'],
      ['--json', 'Emit the comparison envelope as JSON.'],
    ],
    notes: [
      'Exit codes:\n  0  at or below the baseline\n  1  the citation total regressed above the baseline',
    ],
  },
});
