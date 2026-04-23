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
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Ajv from 'ajv';
import { getToolRegistry } from '../.agents/scripts/lib/mcp/tool-registry.js';

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

// ---------------------------------------------------------------------------
// Per-tool AJV validation (Story #520 / AC-01, AC-02)
// ---------------------------------------------------------------------------

// Stub SDK that satisfies every symbol getToolRegistry reads. Handlers are
// overwritten with recorders after loading, so these are only consulted for
// schema-construction metadata (STRUCTURED_COMMENT_TYPES, WAVE_TYPE_PATTERN,
// and the assert* helper referenced inside post_structured_comment's
// handler — which we replace anyway).
function buildStubSdk() {
  return {
    STRUCTURED_COMMENT_TYPES: Object.freeze([
      'progress',
      'friction',
      'notification',
      'code-review',
      'retro',
      'retro-partial',
      'epic-run-state',
      'epic-run-progress',
      'epic-plan-state',
      'parked-follow-ons',
      'dispatch-manifest',
    ]),
    WAVE_TYPE_PATTERN: /^wave-\d+-(start|end)$/,
    resolveAndDispatch: async () => ({ ok: true, wave: 0 }),
    hydrateContext: async () => 'prompt',
    transitionTicketState: async () => {},
    cascadeCompletion: async () => {},
    assertValidStructuredCommentType: () => {},
    upsertStructuredComment: async () => {},
  };
}

async function buildRealRegistryServer() {
  const sdk = buildStubSdk();
  const getProvider = () => ({});
  const tools = await getToolRegistry(sdk, getProvider);

  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    strict: false,
  });
  const TOOLS = new Map();
  for (const t of tools) {
    const fullSchema = { type: 'object', ...t.inputSchema };
    TOOLS.set(t.name, {
      definition: {
        name: t.name,
        description: t.description,
        inputSchema: fullSchema,
        outputSchemaRef: t.outputSchemaRef ?? null,
      },
      // Replace the real handler with an args-echoing stub so positive-path
      // tests never touch the provider layer or filesystem.
      handler: async (args) => ({ ok: true, tool: t.name, args }),
      validate: ajv.compile(fullSchema),
    });
  }

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

  async function handleRequest(req) {
    const { id, method, params = {} } = req;
    if (method === 'tools/list') {
      sendResult(id, {
        tools: [...TOOLS.values()].map((t) => t.definition),
      });
      return;
    }
    if (method !== 'tools/call') {
      sendError(id, -32601, `Method not found: ${method}`);
      return;
    }
    const { name, arguments: args = {} } = params;
    const tool = TOOLS.get(name);
    if (!tool) {
      sendError(id, -32601, `Tool not found: ${name}`);
      return;
    }
    if (!tool.validate(args)) {
      sendError(id, -32602, 'Invalid params', {
        tool: name,
        errors: (tool.validate.errors ?? []).map((e) => ({
          path: e.instancePath || '/',
          reason: e.message,
        })),
      });
      return;
    }
    const result = await tool.handler(args);
    sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    });
  }

  return { handleRequest, TOOLS };
}

describe('MCP Server — Per-tool Input Validation', () => {
  let server;
  let nextId = 100;

  before(async () => {
    server = await buildRealRegistryServer();
  });

  async function callTool(name, args) {
    const id = nextId++;
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const response = await capture;
    return { id, response };
  }

  function assertInvalidParams(response, toolName) {
    assert.equal(
      response.error?.code,
      -32602,
      `expected -32602 Invalid params, got ${JSON.stringify(response.error)}`,
    );
    assert.equal(response.error?.message, 'Invalid params');
    assert.equal(response.error?.data?.tool, toolName);
    assert.ok(
      Array.isArray(response.error?.data?.errors) &&
        response.error.data.errors.length > 0,
      'should include at least one {path, reason} entry',
    );
    for (const entry of response.error.data.errors) {
      assert.equal(typeof entry.path, 'string');
      assert.equal(typeof entry.reason, 'string');
    }
  }

  function assertAccepted(response) {
    assert.ok(
      !response.error,
      `expected no error, got ${JSON.stringify(response.error)}`,
    );
    assert.ok(Array.isArray(response.result?.content));
  }

  // ── dispatch_wave ────────────────────────────────────────────────────────
  it('dispatch_wave — accepts valid integer epicId', async () => {
    const { response } = await callTool('dispatch_wave', { epicId: 71 });
    assertAccepted(response);
  });

  it('dispatch_wave — rejects string epicId with -32602', async () => {
    const { response } = await callTool('dispatch_wave', { epicId: '71' });
    assertInvalidParams(response, 'dispatch_wave');
  });

  // ── hydrate_context ──────────────────────────────────────────────────────
  it('hydrate_context — accepts well-shaped task + epicId', async () => {
    const { response } = await callTool('hydrate_context', {
      task: { id: 1, title: 'do a thing' },
      epicId: 71,
    });
    assertAccepted(response);
  });

  it('hydrate_context — rejects task missing required id/title', async () => {
    const { response } = await callTool('hydrate_context', {
      task: { body: 'no id here' },
      epicId: 71,
    });
    assertInvalidParams(response, 'hydrate_context');
  });

  // ── transition_ticket_state ──────────────────────────────────────────────
  it('transition_ticket_state — accepts an enumerated agent:: state', async () => {
    const { response } = await callTool('transition_ticket_state', {
      ticketId: 42,
      newState: 'agent::done',
    });
    assertAccepted(response);
  });

  it('transition_ticket_state — rejects an unknown newState with -32602', async () => {
    const { response } = await callTool('transition_ticket_state', {
      ticketId: 42,
      newState: 'agent::sleeping',
    });
    assertInvalidParams(response, 'transition_ticket_state');
  });

  // ── cascade_completion ───────────────────────────────────────────────────
  it('cascade_completion — accepts a valid ticketId', async () => {
    const { response } = await callTool('cascade_completion', { ticketId: 7 });
    assertAccepted(response);
  });

  it('cascade_completion — rejects ticketId=0 (minimum:1)', async () => {
    const { response } = await callTool('cascade_completion', { ticketId: 0 });
    assertInvalidParams(response, 'cascade_completion');
  });

  // ── post_structured_comment ──────────────────────────────────────────────
  it('post_structured_comment — accepts a whitelisted type', async () => {
    const { response } = await callTool('post_structured_comment', {
      ticketId: 7,
      type: 'progress',
      payload: 'halfway there',
    });
    assertAccepted(response);
  });

  it('post_structured_comment — rejects an unknown type with -32602', async () => {
    const { response } = await callTool('post_structured_comment', {
      ticketId: 7,
      type: 'unknown-type',
      payload: 'x',
    });
    assertInvalidParams(response, 'post_structured_comment');
  });

  // ── select_audits ────────────────────────────────────────────────────────
  it('select_audits — accepts valid ticketId + gate', async () => {
    const { response } = await callTool('select_audits', {
      ticketId: 71,
      gate: 'gate1',
    });
    assertAccepted(response);
  });

  it('select_audits — rejects missing gate with -32602', async () => {
    const { response } = await callTool('select_audits', { ticketId: 71 });
    assertInvalidParams(response, 'select_audits');
  });

  // ── run_audit_suite ──────────────────────────────────────────────────────
  it('run_audit_suite — accepts a non-empty auditWorkflows array', async () => {
    const { response } = await callTool('run_audit_suite', {
      auditWorkflows: ['audit-clean-code'],
    });
    assertAccepted(response);
  });

  it('run_audit_suite — rejects empty auditWorkflows (minItems:1)', async () => {
    const { response } = await callTool('run_audit_suite', {
      auditWorkflows: [],
    });
    assertInvalidParams(response, 'run_audit_suite');
  });

  // ── outputSchemaRef surfaced via tools/list ──────────────────────────────
  it('tools/list — surfaces outputSchemaRef for every tool', async () => {
    const capture = captureNextWrite();
    await server.handleRequest({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/list',
    });
    const response = await capture;
    const byName = new Map(
      response.result.tools.map((t) => [t.name, t.outputSchemaRef ?? null]),
    );
    assert.equal(
      byName.get('dispatch_wave'),
      '.agents/schemas/dispatch-manifest.json',
    );
    assert.equal(
      byName.get('run_audit_suite'),
      '.agents/schemas/audit-results.schema.json',
    );
    for (const name of [
      'hydrate_context',
      'transition_ticket_state',
      'cascade_completion',
      'post_structured_comment',
      'select_audits',
    ]) {
      assert.equal(
        byName.get(name),
        null,
        `${name} should expose outputSchemaRef:null`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// dispatch_wave persist-failure surfacing (Story #526 / AC-10, AC-11)
//
// Mirrors the persistence-sync block from mcp-orchestration.js (tools/call
// case, `name === 'dispatch_wave'` branch). If that block drifts, keep this
// harness in sync.
// ---------------------------------------------------------------------------

describe('MCP Server — dispatch_wave persist-failure surfacing', () => {
  const TEST_EPIC_ID = 99_999_526;
  const tempDir = path.join(process.cwd(), 'temp');
  const finalJson = path.join(
    tempDir,
    `dispatch-manifest-${TEST_EPIC_ID}.json`,
  );
  const finalMd = path.join(tempDir, `dispatch-manifest-${TEST_EPIC_ID}.md`);
  const residuePaths = [
    finalJson,
    finalMd,
    `${finalJson}.tmp`,
    `${finalMd}.tmp`,
  ];

  function clean() {
    for (const f of residuePaths) {
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
  }

  before(clean);
  after(clean);

  async function invokeDispatchWaveWithPersistenceSync() {
    const result = {
      ok: true,
      wave: 0,
      epicId: TEST_EPIC_ID,
      epicTitle: 'Persist Failure Regression',
      dryRun: false,
      generatedAt: '2026-04-23T00:00:00.000Z',
      summary: {
        totalTasks: 0,
        doneTasks: 0,
        progressPercent: 0,
        dispatched: 0,
        heldForApproval: 0,
        totalWaves: 0,
      },
      storyManifest: [],
    };

    let persisted = false;
    let persistError = null;
    try {
      const { persistManifest } = await import(
        '../.agents/scripts/lib/presentation/manifest-renderer.js'
      );
      const outcome = persistManifest(result);
      persisted = outcome.persisted === true;
      persistError = outcome.error ?? null;
    } catch (err) {
      persisted = false;
      persistError = err?.message ?? String(err);
    }
    result.manifestPersisted = persisted;
    result.manifestPersistError = persistError;
    return result;
  }

  it('fs.writeFileSync EACCES during persist surfaces as { manifestPersisted:false, manifestPersistError:<string> }', async () => {
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = (targetPath, ...rest) => {
      if (String(targetPath).endsWith('.tmp')) {
        const err = new Error('EACCES: permission denied, write');
        err.code = 'EACCES';
        throw err;
      }
      return originalWriteFileSync(targetPath, ...rest);
    };

    let result;
    try {
      result = await invokeDispatchWaveWithPersistenceSync();
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }

    assert.equal(
      result.manifestPersisted,
      false,
      'manifestPersisted must be false after EACCES',
    );
    assert.equal(
      typeof result.manifestPersistError,
      'string',
      'manifestPersistError must be a string (not null / undefined) on failure',
    );
    assert.match(result.manifestPersistError, /EACCES/);

    // Final path on disk is unchanged — EACCES fired on .tmp, so the final
    // name was never created by this call.
    assert.ok(
      !fs.existsSync(finalJson),
      `final ${finalJson} must not exist after persist failure`,
    );
    assert.ok(
      !fs.existsSync(finalMd),
      `final ${finalMd} must not exist after persist failure`,
    );

    // No .tmp residue remains for this epic.
    if (fs.existsSync(tempDir)) {
      const residue = fs
        .readdirSync(tempDir)
        .filter(
          (f) =>
            f.startsWith(`dispatch-manifest-${TEST_EPIC_ID}`) &&
            f.endsWith('.tmp'),
        );
      assert.deepEqual(
        residue,
        [],
        `no .tmp residue expected; saw ${residue.join(', ')}`,
      );
    }
  });
});
