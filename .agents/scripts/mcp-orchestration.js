#!/usr/bin/env node
/**
 * .agents/scripts/mcp-orchestration.js — MCP Server Entry Point
 *
 * Exposes the agent-protocols orchestration SDK as a Model Context Protocol
 * (MCP) server. Agents discover and invoke orchestration tools through their
 * native tool-use interface instead of spawning shell subprocesses.
 *
 * ## Protocol
 * JSON-RPC 2.0 over stdio (newline-delimited).
 * Implements MCP spec: https://spec.modelcontextprotocol.io/
 *
 * ## Backward Compatibility
 * All CLI entry points (dispatcher.js, update-ticket-state.js, etc.) remain
 * fully functional for CI/CD and non-agentic contexts.
 *
 * ## Usage
 * Add to your agent configuration (e.g., MCP host config):
 *   {
 *     "mcpServers": {
 *       "agent-protocols": {
 *         "command": "node",
 *         "args": [".agents/scripts/mcp-orchestration.js"]
 *       }
 *     }
 *   }
 *
 * @see lib/orchestration/index.js — SDK barrel export
 */

import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// MCP Protocol Constants
// ---------------------------------------------------------------------------

const MCP_VERSION = '2024-11-05';
const SERVER_NAME = 'agent-protocols';
const SERVER_VERSION = '5.0.0';

// ---------------------------------------------------------------------------
// Stdio Transport
// ---------------------------------------------------------------------------

/**
 * Send a JSON-RPC response to stdout (newline-delimited).
 * @param {object} msg
 */
function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

/**
 * Send a JSON-RPC 2.0 result response.
 * @param {string|number|null} id
 * @param {unknown} result
 */
function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
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
  send({ jsonrpc: '2.0', id, error });
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
    return createProvider(config.orchestration, { token });
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
        sendResult(id, {
          content: [
            {
              type: 'text',
              text:
                typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        });
      } catch (err) {
        sendResult(id, {
          content: [
            {
              type: 'text',
              text: `Error: ${err?.message ?? String(err)}`,
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
