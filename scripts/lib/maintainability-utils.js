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

/**
 * Recursively scans a directory for JavaScript files.
 * @param {string} dir
 * @param {string[]} fileList
 * @returns {string[]}
 */
export function scanDirectory(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;

  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      // Skip common ignored directories
      if (
        file !== 'node_modules' &&
        file !== '.git' &&
        file !== 'dist' &&
        file !== 'temp' &&
        file !== '.worktrees'
      ) {
        scanDirectory(filePath, fileList);
      }
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      fileList.push(filePath);
    }
  });
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
