import fs from 'node:fs';
import path from 'node:path';
import { calculateForFile } from './maintainability-engine.js';

const BASELINE_FILE = 'maintainability-baseline.json';

/**
 * Loads the current maintainability baseline from disk.
 * @returns {Record<string, number>}
 */
export function getBaseline() {
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    } catch (err) {
      console.warn(
        `[Maintainability] Failed to parse baseline: ${err.message}`,
      );
      return {};
    }
  }
  return {};
}

/**
 * Saves a new maintainability baseline to disk.
 * @param {Record<string, number>} baseline
 */
export function saveBaseline(baseline) {
  // Sort keys for deterministic output
  const sortedBaseline = Object.keys(baseline)
    .sort()
    .reduce((acc, key) => {
      acc[key] = baseline[key];
      return acc;
    }, {});

  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(sortedBaseline, null, 2)}\n`,
  );
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'temp',
  '.worktrees',
]);

/**
 * Recursively scans a directory for JavaScript files.
 * @param {string} dir
 * @param {string[]} fileList
 * @returns {string[]}
 */
export function scanDirectory(dir, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return fileList;
    throw err;
  }

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scanDirectory(filePath, fileList);
      }
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))
    ) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Calculates maintainability scores for a list of file paths.
 * @param {string[]} paths
 * @returns {Record<string, number>}
 */
export function calculateAll(paths) {
  const scores = {};
  paths.forEach((p) => {
    // Use relative paths for the baseline to ensure portability
    const relativePath = path.relative(process.cwd(), p).replace(/\\/g, '/');
    try {
      scores[relativePath] = calculateForFile(p);
    } catch (err) {
      console.error(`[Maintainability] Failed to process ${p}: ${err.message}`);
    }
  });
  return scores;
}
