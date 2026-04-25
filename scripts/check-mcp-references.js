#!/usr/bin/env node

/**
 * scripts/check-mcp-references.js — Retired-MCP-Tool Reference Guard
 *
 * Fails the pre-commit hook if any tracked `.md` file under `.agents/`
 * contains the literal string `mcp__agent-protocols__`. The
 * agent-protocols MCP server has been retired in favour of CLI wrappers
 * (e.g. `node .agents/scripts/post-structured-comment.js`), so any
 * `mcp__agent-protocols__*` reference in workflow markdown is a stale
 * instruction that will mislead agents at run time.
 *
 * Invoked from `.husky/pre-commit` after `check-version-sync.js`. Scans
 * every `.md` file under the `.agents/` tree (not just staged files) —
 * the tree is small enough for the cost to be negligible, and a
 * tree-wide scan catches drift introduced outside `git add` paths
 * (e.g. merge resolutions). Exits non-zero with the file:line of every
 * match.
 *
 * Usage:
 *   node scripts/check-mcp-references.js
 *
 * Exit codes:
 *   0 — No matches.
 *   1 — One or more matches (details on stderr).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const FORBIDDEN = 'mcp__agent-protocols__';

export function findMarkdownFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      findMarkdownFiles(full, acc);
    } else if (st.isFile() && entry.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

export function scanFile(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(FORBIDDEN)) {
      hits.push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return hits;
}

export function checkMcpReferences(root = DEFAULT_ROOT) {
  const agentsDir = resolve(root, '.agents');
  const files = findMarkdownFiles(agentsDir);
  const matches = [];
  for (const file of files) {
    for (const hit of scanFile(file)) {
      matches.push({ file: relative(root, file), ...hit });
    }
  }
  return { ok: matches.length === 0, matches };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = checkMcpReferences();
    if (!result.ok) {
      console.error(
        `[check-mcp-references] Found ${result.matches.length} forbidden ` +
          `'${FORBIDDEN}' reference(s) in .agents tree:`,
      );
      for (const m of result.matches) {
        console.error(`  ${m.file}:${m.line}  ${m.text}`);
      }
      console.error(
        '[check-mcp-references] The agent-protocols MCP tools have been ' +
          'retired. Replace each reference with the equivalent CLI form ' +
          "(e.g. 'node .agents/scripts/post-structured-comment.js ...').",
      );
      process.exit(1);
    }
    console.log('[check-mcp-references] ✅ no forbidden references');
  } catch (err) {
    console.error(`[check-mcp-references] ${err.message}`);
    process.exit(1);
  }
}
