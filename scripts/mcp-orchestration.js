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
  const {
    resolveAndDispatch,
    hydrateContext,
    transitionTicketState,
    cascadeCompletion,
    postStructuredComment,
  } = await import('./lib/orchestration/index.js');

  const { resolveConfig } = await import('./lib/config-resolver.js');
  const { createProvider } = await import('./lib/provider-factory.js');

  function getProvider(token) {
    const config = resolveConfig();
    return createProvider(config.orchestration, { token });
  }

  // ── dispatch_wave ─────────────────────────────────────────────────────────
  registerTool(
    'dispatch_wave',
    'Dispatch the next ready wave of Tasks for an Epic, OR execute tasks for a Story. Automatically detects ticket type from labels. Set dryRun=true for a status view without side-effects.',
    {
      properties: {
        epicId: {
          type: 'number',
          description:
            'The GitHub issue number of the Epic or Story to process.',
        },
        dryRun: {
          type: 'boolean',
          description:
            'If true, compute and return the manifest without transitioning ticket states.',
        },
        githubToken: {
          type: 'string',
          description: 'Optional GitHub PAT. Overrides environment variables.',
        },
      },
      required: ['epicId'],
    },
    async ({ epicId, dryRun = false, githubToken }) => {
      const provider = getProvider(githubToken);
      return resolveAndDispatch({ ticketId: epicId, dryRun, provider });
    },
  );

  // ── hydrate_context ───────────────────────────────────────────────────────
  registerTool(
    'hydrate_context',
    'Build the full execution prompt for a Task by assembling persona, skills, hierarchy context, and the agent protocol template.',
    {
      properties: {
        task: {
          type: 'object',
          description:
            'The normalized task object (id, title, body, persona, skills, protocolVersion).',
        },
        epicBranch: {
          type: 'string',
          description: 'The Epic base branch name, e.g. "epic/71".',
        },
        taskBranch: {
          type: 'string',
          description:
            'The task/story branch name, e.g. "story/epic-71/my-story".',
        },
        epicId: {
          type: 'number',
          description: 'The Epic issue number.',
        },
        githubToken: {
          type: 'string',
          description: 'Optional GitHub PAT. Overrides environment variables.',
        },
      },
      required: ['task', 'epicId'],
    },
    async ({ task, epicBranch, taskBranch, epicId, githubToken }) => {
      const provider = getProvider(githubToken);
      const prompt = await hydrateContext(
        task,
        provider,
        epicBranch,
        taskBranch,
        epicId,
      );
      return { prompt };
    },
  );

  // ── transition_ticket_state ───────────────────────────────────────────────
  registerTool(
    'transition_ticket_state',
    'Transition a ticket to a new agent state label (agent::ready, agent::executing, agent::review, agent::done). Automatically closes/reopens the issue to match.',
    {
      properties: {
        ticketId: {
          type: 'number',
          description: 'The GitHub issue number to update.',
        },
        newState: {
          type: 'string',
          enum: [
            'agent::ready',
            'agent::executing',
            'agent::review',
            'agent::done',
          ],
          description: 'Target state label.',
        },
        githubToken: {
          type: 'string',
          description: 'Optional GitHub PAT. Overrides environment variables.',
        },
      },
      required: ['ticketId', 'newState'],
    },
    async ({ ticketId, newState, githubToken }) => {
      const provider = getProvider(githubToken);
      await transitionTicketState(provider, ticketId, newState);
      return { success: true, ticketId, newState };
    },
  );

  // ── cascade_completion ────────────────────────────────────────────────────
  registerTool(
    'cascade_completion',
    'Recursively propagate ticket completion upward through the hierarchy. If all children of a parent are done, the parent is also marked done and the cascade continues.',
    {
      properties: {
        ticketId: {
          type: 'number',
          description: 'The completed ticket to cascade from.',
        },
        githubToken: {
          type: 'string',
          description: 'Optional GitHub PAT. Overrides environment variables.',
        },
      },
      required: ['ticketId'],
    },
    async ({ ticketId, githubToken }) => {
      const provider = getProvider(githubToken);
      await cascadeCompletion(provider, ticketId);
      return { success: true, ticketId };
    },
  );

  // ── post_structured_comment ───────────────────────────────────────────────
  registerTool(
    'post_structured_comment',
    'Post a structured comment (progress, friction, or notification) on a ticket.',
    {
      properties: {
        ticketId: {
          type: 'number',
          description: 'The GitHub issue number to comment on.',
        },
        type: {
          type: 'string',
          enum: ['progress', 'friction', 'notification'],
          description: 'Type of structured comment.',
        },
        payload: {
          type: 'string',
          description: 'The comment body text.',
        },
        githubToken: {
          type: 'string',
          description: 'Optional GitHub PAT. Overrides environment variables.',
        },
      },
      required: ['ticketId', 'type', 'payload'],
    },
    async ({ ticketId, type, payload, githubToken }) => {
      const provider = getProvider(githubToken);
      await postStructuredComment(provider, ticketId, type, payload);
      return { success: true, ticketId };
    },
  );

  // ── select_audits ─────────────────────────────────────────────────────────
  const { selectAudits } = await import('./mcp/select-audits.js');
  registerTool(
    'select_audits',
    'Analyzes ticket content and file changes to determine which audits to run based on audit-rules.json.',
    {
      properties: {
        ticketId: {
          type: 'number',
          description: 'The GitHub issue number to evaluate.',
        },
        gate: {
          type: 'string',
          description:
            'The current audit gate (e.g. gate1, gate2, gate3, gate4).',
        },
        githubToken: {
          type: 'string',
          description: 'Optional GitHub PAT. Overrides environment variables.',
        },
        baseBranch: {
          type: 'string',
          description: 'The base branch to diff against, defaults to "main".',
        },
      },
      required: ['ticketId', 'gate'],
    },
    async ({ ticketId, gate, githubToken, baseBranch = 'main' }) => {
      const provider = getProvider(githubToken);
      return selectAudits({ ticketId, gate, provider, baseBranch });
    },
  );

  // ── run_audit_suite ───────────────────────────────────────────────────────
  const { runAuditSuite } = await import('./mcp/run-audit-suite.js');
  registerTool(
    'run_audit_suite',
    'Executes a list of audit workflows and aggregates their results into a standard JSON format.',
    {
      properties: {
        auditWorkflows: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of audit workflow names to execute (e.g. ["audit-clean-code"]).',
        },
      },
      required: ['auditWorkflows'],
    },
    async ({ auditWorkflows }) => {
      // Execute the audit suite logic
      return runAuditSuite({ auditWorkflows });
    },
  );
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
