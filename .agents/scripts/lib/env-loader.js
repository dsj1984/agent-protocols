import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './Logger.js';

/**
 * Parse the right-hand side of a `KEY=` line into its value.
 *
 * Two rules, and the quoting decides which one applies:
 *
 *  - **Quoted** (`"…"` / `'…'`): the contents between the opening quote and
 *    its matching closing quote are kept **verbatim** — a `#` inside quotes is
 *    part of the value, not a comment. Anything after the closing quote is
 *    trailing commentary and is discarded.
 *  - **Unquoted**: the value ends at the first **unescaped** `#`. A `\#`
 *    escape emits a literal `#` and keeps the scan going, so a value that
 *    genuinely contains a hash can still be written without quotes.
 *
 * An opening quote with no closing partner is not a quoted value — it falls
 * through to the unquoted rule so a malformed line still yields something
 * rather than swallowing the rest of the file's intent.
 *
 * @param {string} raw — the text after the `=`, unparsed.
 * @returns {string} The value with any inline comment removed.
 */
function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';

  const quote = trimmed.charAt(0);
  if (quote === '"' || quote === "'") {
    const closing = trimmed.indexOf(quote, 1);
    // Verbatim contents: no comment stripping, no unescaping.
    if (closing !== -1) return trimmed.slice(1, closing);
  }

  let value = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed.charAt(i);
    if (char === '\\' && trimmed.charAt(i + 1) === '#') {
      value += '#';
      i += 1;
      continue;
    }
    if (char === '#') break;
    value += char;
  }
  return value.trim();
}

/**
 * Auto-load .env from the project root if it exists
 */
export function loadEnv(projectRoot) {
  const envPath = path.resolve(projectRoot, '.env');
  let envContent;
  try {
    // Read directly rather than existsSync + readFileSync: the latter is a
    // TOCTOU race (the file can vanish between the two calls) and double-stats
    // the path. A single read with code-based error handling is both correct
    // and cheaper.
    envContent = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    // A missing .env is the expected case — environment may be provided via
    // other means, so stay silent. Any other failure (permissions, a
    // directory in place of the file, I/O error) is worth surfacing so the
    // operator gets a one-line hint instead of an opaque silent skip.
    if (err.code !== 'ENOENT') {
      Logger.warn(
        `env-loader: failed to read ${envPath} (${err.code ?? err.message}); skipping .env load.`,
      );
    }
    return;
  }

  envContent.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      process.env[key] = parseEnvValue(match[2] || '');
    }
  });
}
