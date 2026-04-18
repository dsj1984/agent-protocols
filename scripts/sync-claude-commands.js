#!/usr/bin/env node

/**
 * Syncs .agents/workflows/ → .claude/commands/ so Claude Code exposes each
 * workflow as a slash command.  The workflows directory remains the single
 * source of truth; this script is the only writer of .claude/commands/.
 *
 * Usage:  node .agents/scripts/sync-claude-commands.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const SRC_DIR = path.join(PROJECT_ROOT, '.agents', 'workflows');
const DEST_DIR = path.join(PROJECT_ROOT, '.claude', 'commands');

const HEADER =
  '<!-- AUTO-GENERATED — do not edit. Source of truth: .agents/workflows/ -->\n<!-- Re-run: npm run sync:commands -->\n\n';

fs.mkdirSync(DEST_DIR, { recursive: true });

// Remove stale commands that no longer have a source workflow
const existing = fs.readdirSync(DEST_DIR).filter((f) => f.endsWith('.md'));
const sources = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.md'));
const sourceSet = new Set(sources);

for (const file of existing) {
  if (!sourceSet.has(file)) {
    fs.unlinkSync(path.join(DEST_DIR, file));
    console.log(`  removed  ${file} (no longer in workflows)`);
  }
}

// Copy each workflow, prepending the auto-generated header. Parallelised so
// the 27-file sync doesn't serialise on per-file fs latency (noticeable on
// Windows where each syscall pays a larger fixed cost).
let synced = 0;
await Promise.all(
  sources.map(async (file) => {
    const content = await fs.promises.readFile(
      path.join(SRC_DIR, file),
      'utf8',
    );
    const dest = path.join(DEST_DIR, file);
    const target = HEADER + content;

    // Skip write if content is already identical (avoid noisy git diffs).
    // Use try/catch over existsSync+readFile so we only pay one syscall.
    try {
      const existingContent = await fs.promises.readFile(dest, 'utf8');
      if (existingContent === target) return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    await fs.promises.writeFile(dest, target, 'utf8');
    synced++;
    console.log(`  synced   ${file}`);
  }),
);

console.log(
  `\n✔ ${synced} file(s) synced, ${sources.length} total commands in .claude/commands/`,
);
