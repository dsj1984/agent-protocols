#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- STDOUT GUARD (MUST BE FIRST) ---
const _realStdoutWrite = process.stdout.write.bind(process.stdout);
const _realStderrWrite = process.stderr.write.bind(process.stderr);
const BYPASS = Symbol.for('mcp.stdout.bypass');
process[BYPASS] = false;

process.stdout.write = (chunk, encoding, callback) => {
  if (process[BYPASS]) return _realStdoutWrite(chunk, encoding, callback);
  return _realStderrWrite(chunk, encoding, callback);
};

const _redir = (...args) =>
  process.stderr.write(`[MCP REDIR] ${args.join(' ')}\n`);
console.log = _redir;
console.info = _redir;
console.warn = _redir;
console.debug = _redir;
console.error = _redir;

function sendMcp(msg) {
  const payload = Buffer.from(`${JSON.stringify(msg)}\n`, 'utf8');
  process[BYPASS] = true;
  try {
    fs.writeSync(1, payload);
  } finally {
    process[BYPASS] = false;
  }
}

// ------------------------------------
import { createInterface } from 'node:readline';
import Ajv from 'ajv';
import { formatError } from './lib/error-formatting.js';

const _ajv = new Ajv({ allowUnionTypes: true });
const MCP_REQUEST_SCHEMA = {
  type: 'object',
  required: ['jsonrpc', 'method'],
  properties: {
    jsonrpc: { type: 'string', const: '2.0' },
    id: { type: ['string', 'number', 'null'] },
    method: { type: 'string' },
    params: { type: ['object', 'array'] },
  },
};
const _validateMcpRequest = _ajv.compile(MCP_REQUEST_SCHEMA);

// ---------------------------------------------------------------------------
// MCP Protocol Constants
// ---------------------------------------------------------------------------

const MCP_VERSION = '2024-11-05';
const SERVER_NAME = 'agent-protocols';
const __mcp_dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_VERSION = fs
  .readFileSync(path.join(__mcp_dirname, '../VERSION'), 'utf8')
  .trim();

// ---------------------------------------------------------------------------
// Stdio Transport
// ---------------------------------------------------------------------------

/**
 * Send a JSON-RPC 2.0 result response.
 * @param {string|number|null} id
 * @param {unknown} result
 */
function sendResult(id, result) {
  sendMcp({ jsonrpc: '2.0', id, result });
}

/**
 * Send a JSON-RPC 2.0 error response.
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {unknown} [data]
 */
function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  sendMcp({ jsonrpc: '2.0', id, error });
}

// ---------------------------------------------------------------------------
// Tool Registry (populated lazily after SDK import)
// ---------------------------------------------------------------------------

/** @type {Map<string, { definition: object, handler: (params: object) => Promise<unknown> }>} */
const TOOLS = new Map();

/**
 * Register a tool with its JSON Schema definition and handler.
 * @param {string} name
 * @param {string} description
 * @param {object} inputSchema - JSON Schema for the tool's input parameters
 * @param {(params: object) => Promise<unknown>} handler
 */
function registerTool(name, description, inputSchema, handler) {
  TOOLS.set(name, {
    definition: {
      name,
      description,
      inputSchema: {
        type: 'object',
        ...inputSchema,
      },
    },
    handler,
  });
}

// ---------------------------------------------------------------------------
// SDK Tool Registration
// ---------------------------------------------------------------------------

/**
 * Dynamically import the orchestration SDK and register tools.
 * Using dynamic import so failures are isolated and reported clearly.
 */
async function registerSDKTools() {
  const sdk = await import('./lib/orchestration/index.js');
  const { resolveConfig } = await import('./lib/config-resolver.js');
  const { createProvider } = await import('./lib/provider-factory.js');
  const { getToolRegistry } = await import('./lib/mcp/tool-registry.js');

  function getProvider(token) {
    const config = resolveConfig();
    try {
      return createProvider(config.orchestration, { token });
    } catch (err) {
      if (err.message.includes('No GitHub token found')) {
        const mcpError = new Error(
          '[MCP Orchestration] Authentication Failure: No GITHUB_TOKEN environment variable found. ' +
            'To fix this, ensure the GITHUB_TOKEN is set in the environment where the MCP server is running, ' +
            'or pass it explicitly via the "githubToken" argument in the tool call.',
        );
        throw mcpError;
      }
      throw err;
    }
  }

  const tools = await getToolRegistry(sdk, getProvider);
  for (const t of tools) {
    registerTool(t.name, t.description, t.inputSchema, t.handler);
  }
}

// ---------------------------------------------------------------------------
// Request Handler
// ---------------------------------------------------------------------------

/**
 * Handle a single parsed JSON-RPC request.
 * @param {object} req
 */
async function handleRequest(req) {
  const { id, method, params = {} } = req;

  // Validate JSON-RPC structure
  if (req.jsonrpc !== '2.0') {
    return sendError(
      id ?? null,
      -32600,
      'Invalid Request: missing jsonrpc version',
    );
  }

  switch (method) {
    // ── MCP lifecycle ───────────────────────────────────────────────────────
    case 'initialize': {
      sendResult(id, {
        protocolVersion: MCP_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      break;
    }

    case 'notifications/initialized': {
      // Notification — no response needed per MCP spec
      break;
    }

    case 'ping': {
      sendResult(id, {});
      break;
    }

    // ── Tool discovery ──────────────────────────────────────────────────────
    case 'tools/list': {
      const tools = [...TOOLS.values()].map((t) => t.definition);
      sendResult(id, { tools });
      break;
    }

    // ── Tool invocation ─────────────────────────────────────────────────────
    case 'tools/call': {
      const { name, arguments: args = {} } = params;

      if (!name) {
        return sendError(id, -32602, 'Invalid params: missing tool name');
      }

      const tool = TOOLS.get(name);
      if (!tool) {
        return sendError(id, -32601, `Tool not found: ${name}`);
      }

      try {
        const result = await tool.handler(args);

        // PERSISTENCE SYNC: Manually write files to temp/ so that the project
        // state matches what would have happened if run via CLI dispatcher.js.
        // We use the new persistManifest abstraction to do this cleanly.
        if (name === 'dispatch_wave' && result && typeof result === 'object') {
          try {
            const { persistManifest } = await import(
              './lib/presentation/manifest-renderer.js'
            );
            persistManifest(result);
          } catch (persistErr) {
            process.stderr.write(
              `[MCP] Failed to persist manifest to temp/: ${persistErr.message}\n`,
            );
          }
        }

        sendResult(id, {
          content: [
            {
              type: 'text',
              text:
                result != null
                  ? typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2)
                  : '',
            },
          ],
        });
      } catch (err) {
        sendResult(id, {
          content: [
            {
              type: 'text',
              text: `Error: ${formatError(err)}`,
            },
          ],
          isError: true,
        });
      }
      break;
    }

    // ── Unknown method ──────────────────────────────────────────────────
    default: {
      // MCP notifications (method starts with "notifications/") must be
      // silently ignored — they carry no `id` and expect no response.
      if (method?.startsWith('notifications/')) break;

      sendError(id ?? null, -32601, `Method not found: ${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main — Stdio Loop
// ---------------------------------------------------------------------------

async function main() {
  // stdout guard is already active at module scope (lines 14-35)

  // Register all SDK tools before accepting messages
  try {
    await registerSDKTools();
  } catch (err) {
    process.stderr.write(
      `[MCP] Failed to register SDK tools: ${err?.message}\n`,
    );
    process.exit(1);
  }

  // Read newline-delimited JSON from stdin
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      sendError(null, -32700, 'Parse error: invalid JSON');
      return;
    }

    if (!_validateMcpRequest(req)) {
      // Echo req.id when present so clients can correlate the error to the
      // request they sent — matches the catch-block pattern below.
      sendError(
        req?.id ?? null,
        -32600,
        'Invalid Request: schema validation failed',
        _validateMcpRequest.errors,
      );
      return;
    }

    try {
      await handleRequest(req);
    } catch (err) {
      sendError(req?.id ?? null, -32603, 'Internal error', err?.message);
    }
  });

  rl.on('close', () => {
    // stdin closed — graceful shutdown
    process.exit(0);
  });

  // Log to stderr so it doesn't interfere with the JSON-RPC stdout channel
  process.stderr.write(
    `[MCP] agent-protocols v${SERVER_VERSION} server started (protocol ${MCP_VERSION})\n`,
  );
}

main();
