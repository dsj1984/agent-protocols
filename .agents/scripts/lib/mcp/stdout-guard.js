/**
 * .agents/scripts/lib/mcp/stdout-guard.js
 *
 * Intercepts all stdout writes and redirects them to stderr to prevent
 * corruption of the MCP JSON-RPC stream.
 */

process.env.MCP_SERVER = 'true';

import fs from 'node:fs';

const _realStdoutWrite = process.stdout.write.bind(process.stdout);
const _realStderrWrite = process.stderr.write.bind(process.stderr);

const BYPASS = Symbol.for('mcp.stdout.bypass');
process[BYPASS] = false;

/**
 * Intercept all stdout writes.
 * Redirect to stderr unless the BYPASS flag is set.
 */
process.stdout.write = (chunk, encoding, callback) => {
  if (process[BYPASS]) {
    return _realStdoutWrite(chunk, encoding, callback);
  }
  return _realStderrWrite(chunk, encoding, callback);
};

// Redirect all console methods to stderr
const _redir = (...args) => console.error('[MCP REDIR]', ...args);
console.log = _redir;
console.info = _redir;
console.warn = _redir;
console.debug = _redir;

/**
 * Send a legitimate MCP JSON-RPC message to stdout.
 * Uses fs.writeSync to bypass any stream-level buffering or overrides.
 */
export function sendMcp(msg) {
  const payload = Buffer.from(`${JSON.stringify(msg)}\n`, 'utf8');
  process[BYPASS] = true;
  try {
    fs.writeSync(1, payload);
  } finally {
    process[BYPASS] = false;
  }
}

export function activateStdoutGuard() {
  // Logic is active on module load
}
