/**
 * fs-utils.js
 *
 * Shared filesystem utility helpers to reduce boilerplate across
 * orchestration scripts. Provides a safe, reusable directory-assertion
 * method that flattens the repeated if-existsSync/mkdirSync pattern.
 */

import fs from 'node:fs';

/**
 * Ensures a directory exists, creating it (and any parent directories)
 * if it does not. This is a safe, idempotent operation.
 *
 * Replaces scattered:
 *   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
 *
 * @param {string} dir - Absolute path to the directory to ensure.
 */
export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
