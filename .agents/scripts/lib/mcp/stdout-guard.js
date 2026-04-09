/**
 * .agents/scripts/lib/mcp/stdout-guard.js
 *
 * Intercepts all stdout writes and redirects them to stderr to prevent
 * corruption of the MCP JSON-RPC stream.
 */

process.env.MCP_SERVER = 'true';

const _realStdoutWrite = process.stdout.write.bind(process.stdout);
const _realStderrWrite = process.stderr.write.bind(process.stderr);

let _bypass = false;

process.stdout.write = (chunk, encoding, callback) => {
  if (_bypass) {
    return _realStdoutWrite(chunk, encoding, callback);
  }
  return _realStderrWrite(chunk, encoding, callback);
};

// Also redirect console methods
const _redir = (...args) => console.error('[MCP REDIR]', ...args);
console.log = _redir;
console.info = _redir;
console.warn = _redir;
console.debug = _redir;

/**
 * Enable the bypass to send legitimate MCP JSON-RPC messages.
 */
export function setMcpBypass(value) {
  _bypass = !!value;
}

/**
 * Send a message to the real stdout.
 */
export function sendMcp(msg) {
  setMcpBypass(true);
  try {
    _realStdoutWrite(`${JSON.stringify(msg)}\n`, 'utf8');
  } finally {
    setMcpBypass(false);
  }
}
