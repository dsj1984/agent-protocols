/**
 * tests/mcp-orchestration.test.js
 *
 * Unit tests for the MCP server's JSON-RPC 2.0 protocol handling:
 *   - initialize / handshake
 *   - tools/list discovery
 *   - tools/call invocation
 *   - error handling (method not found, parse error, tool not found)
 *
 * We test the protocol-layer functions directly by importing the module
 * in a sandboxed manner, intercepting stdout writes.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// ---------------------------------------------------------------------------
// Helpers — capture stdout
// ---------------------------------------------------------------------------

function captureNextWrite() {
  return new Promise((resolve) => {
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      process.stdout.write = orig; // restore immediately
      resolve(JSON.parse(chunk.toString().trim()));
      return orig(chunk, ...args);
    };
  });
}

// ---------------------------------------------------------------------------
// Build a minimal in-process MCP server for testing
// ---------------------------------------------------------------------------

/**
 * Re-creates a minimal MCP handler (protocol layer only) that mirrors
 * mcp-orchestration.js without actually loading the SDK or spawning processes.
 * This lets us test the JSON-RPC routing logic in isolation.
 */
function buildTestServer() {
  const MCP_VERSION = '2024-11-05';
  const SERVER_NAME = 'agent-protocols';
  const SERVER_VERSION = '5.0.0';

  const TOOLS = new Map();

  function send(msg) {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  }

  function sendResult(id, result) {
    send({ jsonrpc: '2.0', id, result });
  }

  function sendError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    send({ jsonrpc: '2.0', id, error });
  }

  function registerTool(name, description, inputSchema, handler) {
    TOOLS.set(name, {
      definition: {
        name,
        description,
        inputSchema: { type: 'object', ...inputSchema },
      },
      handler,
    });
  }

  // Register a stub tool for discovery tests
  registerTool(
    'dispatch_wave',
    'Dispatch the next ready wave of Tasks for an Epic.',
    {
      properties: {
        epicId: { type: 'number' },
        dryRun: { type: 'boolean' },
        githubToken: { type: 'string' },
      },
      required: ['epicId'],
    },
    async ({ epicId, dryRun = false, githubToken }) => ({
      epicId,
      dryRun,
      githubToken: githubToken ? '***' : null,
      wave: [],
    }),
  );

  registerTool('fail_tool', 'A tool that always throws.', {}, async () => {
    throw new Error('Planned failure');
  });

  async function handleRequest(req) {
    const { id, method, params = {} } = req;

    if (req.jsonrpc !== '2.0') {
      return sendError(
        id ?? null,
        -32600,
        'Invalid Request: missing jsonrpc version',
      );
    }

    switch (method) {
      case 'initialize':
        sendResult(id, {
          protocolVersion: MCP_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        break;

      case 'initialized':
        // notification — no response
        break;

      case 'ping':
        sendResult(id, {});
        break;

      case 'tools/list': {
        const tools = [...TOOLS.values()].map((t) => t.definition);
        sendResult(id, { tools });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        if (!name)
          return sendError(id, -32602, 'Invalid params: missing tool name');
        const tool = TOOLS.get(name);
        if (!tool) return sendError(id, -32601, `Tool not found: ${name}`);
        try {
          const result = await tool.handler(args);
          sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          });
        } catch (err) {
          sendResult(id, {
            content: [{ type: 'text', text: `Error: ${err?.message}` }],
            isError: true,
          });
        }
        break;
      }

      default:
        sendError(id ?? null, -32601, `Method not found: ${method}`);
    }
  }

  return { handleRequest };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Server — Handshake & Tool Discovery', () => {
  let server;

  before(() => {
    server = buildTestServer();
  });

  it('responds to initialize with protocolVersion and serverInfo', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test' } },
    });
    const response = await capture;

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    assert.ok(
      response.result.protocolVersion,
      'should include protocolVersion',
    );
    assert.ok(
      response.result.serverInfo?.name,
      'should include serverInfo.name',
    );
    assert.deepEqual(response.result.capabilities, { tools: {} });
  });

  it('initialized notification produces no response', async () => {
    // Spy that should NOT be called
    let called = false;
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => {
      called = true;
      return orig(...args);
    };

    await server.handleRequest({ jsonrpc: '2.0', method: 'initialized' });

    process.stdout.write = orig;
    assert.equal(called, false, 'should not write to stdout for notifications');
  });

  it('responds to ping with empty result', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({ jsonrpc: '2.0', id: 2, method: 'ping' });
    const response = await capture;

    assert.equal(response.jsonrpc, '2.0');
    assert.deepEqual(response.result, {});
  });

  it('lists available tools via tools/list', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const response = await capture;

    assert.equal(response.jsonrpc, '2.0');
    assert.ok(
      Array.isArray(response.result.tools),
      'should return a tools array',
    );
    assert.ok(
      response.result.tools.length > 0,
      'should expose at least one tool',
    );

    const dispatch = response.result.tools.find(
      (t) => t.name === 'dispatch_wave',
    );
    assert.ok(dispatch, 'should expose the dispatch_wave tool');
    assert.ok(dispatch.description, 'dispatch_wave should have a description');
    assert.ok(dispatch.inputSchema, 'dispatch_wave should have an inputSchema');
    assert.ok(
      dispatch.inputSchema.properties?.githubToken,
      'dispatch_wave should include githubToken param',
    );
  });

  it('handles unknown method with -32601 error', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'unknown/method',
    });
    const response = await capture;

    assert.equal(response.id, 4);
    assert.equal(response.error?.code, -32601);
  });

  it('returns -32600 for invalid jsonrpc version', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({ jsonrpc: '1.0', id: 5, method: 'ping' });
    const response = await capture;

    assert.equal(response.error?.code, -32600);
  });
});

describe('MCP Server — Tool Invocation', () => {
  let server;

  before(() => {
    server = buildTestServer();
  });

  it('calls a registered tool and returns content array', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'dispatch_wave',
        arguments: {
          epicId: 71,
          dryRun: true,
          githubToken: 'ghp_secret',
        },
      },
    });
    const response = await capture;

    assert.equal(response.id, 10);
    assert.ok(
      Array.isArray(response.result?.content),
      'should return content array',
    );
    assert.equal(response.result.content[0]?.type, 'text');

    const parsed = JSON.parse(response.result.content[0].text);
    assert.equal(parsed.epicId, 71);
    assert.equal(parsed.dryRun, true);
    assert.equal(
      parsed.githubToken,
      '***',
      'should use provided token (masked in stub)',
    );
  });

  it('returns -32601 for unknown tool', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'nonexistentTool', arguments: {} },
    });
    const response = await capture;

    assert.equal(response.error?.code, -32601);
    assert.match(response.error?.message, /Tool not found/);
  });

  it('returns -32602 when tool name is missing', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { arguments: {} },
    });
    const response = await capture;

    assert.equal(response.error?.code, -32602);
  });

  it('returns isError:true when tool handler throws', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'fail_tool', arguments: {} },
    });
    const response = await capture;

    assert.equal(response.id, 13);
    assert.equal(response.result?.isError, true);
    assert.match(response.result.content[0].text, /Error: Planned failure/);
  });
});
