#!/usr/bin/env node

/**
 * .agents/scripts/validate-docs-freshness.js — Documentation Freshness Gate
 *
 * For each doc in `release.docs` + `agentSettings.docsContextFiles`, verify
 * that the file was meaningfully updated during this Epic's lifecycle. A
 * file passes when **either** of the following holds:
 *
 *   1. `git log --all --grep="#<epicId>" -- <file>` returns a commit —
 *      the Epic ID was referenced in a commit message that touched the
 *      file.
 *   2. The file's current body contains `#<epicId>` — a human annotation
 *      (e.g., a CHANGELOG entry) explicitly ties the change to this Epic.
 *
 * The prior gate accepted any diff against the base branch — a stray
 * whitespace edit or a one-line unrelated cleanup passed, defeating the
 * purpose of the check. Requiring an Epic-ID reference makes "did you
 * update the docs for this Epic?" a falsifiable question instead of a
 * checkbox.
 *
 * Usage:
 *   node .agents/scripts/validate-docs-freshness.js --epic <EPIC_ID> [--base main] [--docs <comma-separated>] [--json]
 *
 * `--json` emits a single JSON object on stdout with
 *   { ok, epicId, results: [{ file, pass, reason }, ...] }
 * and suppresses the human-readable log lines. Intended for LLM/tool consumers
 * that need to enumerate failing files without parsing log output.
 *
 * Exit codes:
 *   0 — every doc has an Epic-ID reference.
 *   1 — one or more docs have no reference.
 *   2 — configuration error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import {
  getPaths,
  PROJECT_ROOT,
  resolveConfig,
} from './lib/config-resolver.js';
import { gitSpawn } from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';

/**
 * Resolve the canonical doc list for a release: `release.docs` entries
 * plus `docsContextFiles` prefixed by `docsRoot`. Paths are returned as
 * project-relative POSIX strings so git commands can consume them verbatim.
 *
 * @param {object} settings
 * @returns {string[]}
 */
export function resolveDocList(settings) {
  const releaseDocs = Array.isArray(settings?.release?.docs)
    ? settings.release.docs
    : [];
  const contextDocs = Array.isArray(settings?.docsContextFiles)
    ? settings.docsContextFiles
    : [];
  const docsRoot =
    getPaths({ agentSettings: settings ?? {} }).docsRoot ?? 'docs';
  const resolved = [
    ...releaseDocs,
    ...contextDocs.map((f) => path.posix.join(docsRoot, f)),
  ];
  return Array.from(new Set(resolved));
}

function epicRefMatcher(epicId) {
  // Match `#N` as a standalone token. `(?!\d)` prevents `#10` from
  // satisfying a search for `#1` — a subtle bug the prior diff-only gate
  // never had to guard against.
  return new RegExp(`#${epicId}(?!\\d)`);
}

export function commitsMentioningEpic(docPath, epicId, cwd = PROJECT_ROOT) {
  const res = gitSpawn(
    cwd,
    'log',
    '--all',
    `--grep=#${epicId}`,
    '--pretty=format:%H',
    '--',
    docPath,
  );
  if (res.status !== 0) return [];
  return (res.stdout ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function fileBodyMentionsEpic(
  docPath,
  epicId,
  cwd = PROJECT_ROOT,
  readFileImpl = fs.readFileSync,
) {
  const abs = path.isAbsolute(docPath) ? docPath : path.join(cwd, docPath);
  let body;
  try {
    body = readFileImpl(abs, 'utf8');
  } catch {
    return false;
  }
  return epicRefMatcher(epicId).test(body);
}

/**
 * Run the freshness gate against every resolved doc. Pure; takes
 * everything it needs as inputs so tests don't need a worktree.
 *
 * @param {{
 *   epicId: number,
 *   docs: string[],
 *   cwd?: string,
 *   readFileImpl?: typeof fs.readFileSync,
 *   commitsForFile?: (doc: string, epicId: number, cwd: string) => string[],
 * }} opts
 * @returns {{ ok: boolean, results: Array<{ file: string, pass: boolean, reason: string }> }}
 */
export function runFreshnessGate({
  epicId,
  docs,
  cwd = PROJECT_ROOT,
  readFileImpl = fs.readFileSync,
  commitsForFile = commitsMentioningEpic,
}) {
  const results = docs.map((file) => {
    const commits = commitsForFile(file, epicId, cwd);
    if (commits.length > 0) {
      return {
        file,
        pass: true,
        reason: `${commits.length} commit(s) reference Epic #${epicId}`,
      };
    }
    if (fileBodyMentionsEpic(file, epicId, cwd, readFileImpl)) {
      return {
        file,
        pass: true,
        reason: `body mentions #${epicId}`,
      };
    }
    return {
      file,
      pass: false,
      reason: `no commit message or body reference to #${epicId}`,
    };
  });
  return { ok: results.every((r) => r.pass), results };
}

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      base: { type: 'string' },
      docs: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });
  const epicId = Number.parseInt(values.epic ?? '', 10);
  if (Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal(
      'Usage: node validate-docs-freshness.js --epic <EPIC_ID> [--docs a.md,b.md] [--json]',
    );
  }

  const asJson = values.json === true;
  const { settings } = resolveConfig();
  const docs = values.docs
    ? values.docs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : resolveDocList(settings);

  if (docs.length === 0) {
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, epicId, results: [] })}\n`,
      );
      return;
    }
    console.log(
      `[docs-freshness] ⏭  No docs configured under release.docs or ` +
        `docsContextFiles — nothing to check.`,
    );
    return;
  }

  const { ok, results } = runFreshnessGate({ epicId, docs });

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok, epicId, results })}\n`);
    if (!ok) process.exit(1);
    return;
  }

  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`[docs-freshness] ${icon} ${r.file} — ${r.reason}`);
  }

  if (!ok) {
    console.error(
      `[docs-freshness] ❌ Documentation freshness gate FAILED for Epic #${epicId}.\n\n` +
        `Update each failing file so its commit message or body references #${epicId}, ` +
        `then re-run /sprint-close.`,
    );
    process.exit(1);
  }

  console.log(
    `[docs-freshness] ✅ All ${results.length} doc(s) reference Epic #${epicId}.`,
  );
}

runAsCli(import.meta.url, main, { source: 'validate-docs-freshness' });
