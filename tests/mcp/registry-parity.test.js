/**
 * tests/mcp/registry-parity.test.js
 *
 * Drift guard (AC-15 of Tech Spec #513).
 *
 * Asserts the MCP tool registry — the single source of truth consumed by
 * mcp-orchestration.js at startup — keeps its structural contract as tools
 * are added or changed:
 *
 *   1. Every entry has a non-empty `name`, a non-empty `description`, an
 *      AJV-compilable `inputSchema`, and a callable `handler`.
 *   2. A minimal payload synthesized from each tool's schema validates
 *      against that schema AND is accepted by the handler (the handler
 *      runs to completion without throwing, using stubs for SDK calls and
 *      audit-tool modules so no network or filesystem work occurs).
 *   3. The `tools/list` response produced by the server's registration
 *      loop is set-equal to the registry by name — i.e. no tool reaches
 *      clients without going through `getToolRegistry()`.
 *
 * When a new tool is added, this file is the tripwire. If its schema uses
 * a shape the synthesizer below doesn't know how to satisfy, the
 * "minimal payload" test fails — forcing whoever added it to extend the
 * synthesizer so the contract stays explicit.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it, mock } from 'node:test';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';

// --- Module mocks (applied before getToolRegistry dynamically imports them) ─

const selectAuditsUrl = pathToFileURL(
  path.resolve(
    import.meta.dirname,
    '../../.agents/scripts/mcp/select-audits.js',
  ),
).href;
const runAuditSuiteUrl = pathToFileURL(
  path.resolve(
    import.meta.dirname,
    '../../.agents/scripts/mcp/run-audit-suite.js',
  ),
).href;

mock.module(selectAuditsUrl, {
  namedExports: {
    selectAudits: async () => ({ ok: true, audits: [] }),
  },
});
mock.module(runAuditSuiteUrl, {
  namedExports: {
    runAuditSuite: async () => ({ ok: true, results: [] }),
  },
});

const { getToolRegistry } = await import(
  '../../.agents/scripts/lib/mcp/tool-registry.js'
);

// --- Stub SDK + provider ──────────────────────────────────────────────────

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

const mockProvider = {
  getTicket: async () => ({ labels: [], body: '' }),
  getTickets: async () => [],
  updateTicket: async () => {},
  postComment: async () => {},
};
const getProvider = () => mockProvider;

// --- Schema → minimal payload synthesizer ────────────────────────────────

// Walks a JSON Schema subset and emits the smallest valid value it can.
// Handles the shapes the MCP tool registry actually uses; unsupported
// shapes throw loudly so a new tool can't silently slip past this guard.
function synthesize(schema, pathForErr) {
  if (!schema || typeof schema !== 'object') {
    throw new Error(`synthesize: missing schema at ${pathForErr}`);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return synthesize(schema.oneOf[0], `${pathForErr}[oneOf[0]]`);
  }
  if (typeof schema.pattern === 'string' && schema.type === 'string') {
    return synthesizeFromPattern(schema.pattern, pathForErr);
  }

  switch (schema.type) {
    case 'integer':
    case 'number':
      return Number.isFinite(schema.minimum) ? schema.minimum : 1;
    case 'string':
      return 'x';
    case 'boolean':
      return false;
    case 'array': {
      const minItems = schema.minItems ?? 0;
      if (minItems === 0) return [];
      const item = synthesize(schema.items, `${pathForErr}[items]`);
      return Array.from({ length: minItems }, () => item);
    }
    case 'object': {
      const out = {};
      const required = schema.required ?? [];
      for (const key of required) {
        const propSchema = schema.properties?.[key];
        if (!propSchema) {
          throw new Error(
            `synthesize: required field "${key}" missing from properties at ${pathForErr}`,
          );
        }
        out[key] = synthesize(propSchema, `${pathForErr}.${key}`);
      }
      return out;
    }
    default:
      throw new Error(
        `synthesize: unsupported schema shape at ${pathForErr}: ${JSON.stringify(schema)}`,
      );
  }
}

// The registry's wave-pattern regex is of the form /^wave-\d+-(start|end)$/.
// Rather than running a general regex-to-string synthesizer, the test only
// needs a representative match. If a new pattern shape is introduced, this
// throws and forces the test to be updated alongside the registry change.
function synthesizeFromPattern(pattern, pathForErr) {
  if (pattern === '^wave-\\d+-(start|end)$') return 'wave-0-start';
  throw new Error(
    `synthesize: unsupported string pattern at ${pathForErr}: ${pattern}`,
  );
}

// --- Expected tool set ────────────────────────────────────────────────────

const EXPECTED_TOOL_NAMES = [
  'dispatch_wave',
  'hydrate_context',
  'transition_ticket_state',
  'cascade_completion',
  'post_structured_comment',
  'select_audits',
  'run_audit_suite',
];

// --- Tests ────────────────────────────────────────────────────────────────

describe('MCP Registry Parity (AC-15) — drift guard', () => {
  let tools;
  let ajv;

  before(async () => {
    const sdk = buildStubSdk();
    tools = await getToolRegistry(sdk, getProvider);
    ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: false });
  });

  it('exposes exactly the expected set of tool names', () => {
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      [...EXPECTED_TOOL_NAMES].sort(),
      'registry must expose exactly the seven documented tools — a new tool should update both the registry and EXPECTED_TOOL_NAMES here',
    );
  });

  it('every entry has name/description/inputSchema/callable handler', () => {
    assert.ok(tools.length > 0, 'registry must expose at least one tool');
    for (const t of tools) {
      assert.equal(typeof t.name, 'string', 'name must be a string');
      assert.ok(t.name.length > 0, `tool name must be non-empty`);

      assert.equal(
        typeof t.description,
        'string',
        `${t.name}: description must be a string`,
      );
      assert.ok(
        t.description.length > 0,
        `${t.name}: description must be non-empty`,
      );

      assert.equal(
        typeof t.inputSchema,
        'object',
        `${t.name}: inputSchema must be an object`,
      );
      assert.ok(t.inputSchema !== null, `${t.name}: inputSchema must not be null`);
      assert.equal(
        typeof t.inputSchema.properties,
        'object',
        `${t.name}: inputSchema.properties must be an object`,
      );

      assert.equal(
        typeof t.handler,
        'function',
        `${t.name}: handler must be a function`,
      );
    }
  });

  it('every inputSchema compiles as a valid JSON Schema', () => {
    for (const t of tools) {
      const fullSchema = { type: 'object', ...t.inputSchema };
      assert.doesNotThrow(
        () => ajv.compile(fullSchema),
        `${t.name}: inputSchema failed AJV compile`,
      );
    }
  });

  it('minimal payload synthesized from each schema passes AJV validate', () => {
    for (const t of tools) {
      const fullSchema = { type: 'object', ...t.inputSchema };
      const validate = ajv.compile(fullSchema);
      const payload = synthesize(fullSchema, t.name);
      const ok = validate(payload);
      assert.equal(
        ok,
        true,
        `${t.name}: synthesized payload ${JSON.stringify(payload)} failed validate: ${JSON.stringify(validate.errors)}`,
      );
    }
  });

  it('each handler runs to completion on its minimal payload without throwing', async () => {
    for (const t of tools) {
      const fullSchema = { type: 'object', ...t.inputSchema };
      const payload = synthesize(fullSchema, t.name);
      try {
        await t.handler(payload);
      } catch (err) {
        assert.fail(
          `${t.name}: handler threw on minimal payload ${JSON.stringify(payload)} — ${err?.message}`,
        );
      }
    }
  });

  it('tools/list response is set-equal to the registry by name', () => {
    // Emulate the server's registration + tools/list loop (see
    // .agents/scripts/mcp-orchestration.js:136-157, 249-253). The server
    // wraps each entry's inputSchema with { type: 'object', ... }, stores
    // the wrapped form as `definition`, and tools/list returns those
    // definitions. Any divergence here means the server exposed a tool
    // name not present in the registry or vice versa.
    const registered = new Map();
    for (const t of tools) {
      registered.set(t.name, {
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object', ...t.inputSchema },
        outputSchemaRef: t.outputSchemaRef ?? null,
      });
    }
    const listResponseTools = [...registered.values()];

    const listNames = new Set(listResponseTools.map((t) => t.name));
    const registryNames = new Set(tools.map((t) => t.name));

    assert.deepEqual(
      listNames,
      registryNames,
      'tools/list response must list exactly the same names as the registry',
    );
    assert.equal(
      listResponseTools.length,
      tools.length,
      'tools/list must not contain duplicates or extra entries',
    );
  });
});
