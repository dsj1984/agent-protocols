// lib/migrations/helpers/__tests__/retire-agentrc-key.test.js
/**
 * Unit tests for the shared retire-a-config-key scaffold. The five retire
 * steps now delegate their read/detect/strip/write mechanics here, so the
 * per-step behaviours that used to be asserted five times over — above all
 * the prune depth, which is deliberately different per step — are pinned once
 * against the factory. All tests drive an in-memory fake fs
 * (testing-standards § Unit) — no real filesystem I/O.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AGENTRC_BASE_FILENAME,
  AGENTRC_FILENAMES,
  AGENTRC_LOCAL_FILENAME,
  createRetireAgentrcKeyStep,
} from '../retire-agentrc-key.js';

const PROJECT_ROOT = '/consumer';
const BASE_PATH = path.join(PROJECT_ROOT, AGENTRC_BASE_FILENAME);
const LOCAL_PATH = path.join(PROJECT_ROOT, AGENTRC_LOCAL_FILENAME);

/**
 * @param {{ base?: object | null, local?: object | null }} initial
 * @returns {{ ctx: object, read: (p: string) => object, exists: (p: string) => boolean }}
 */
function makeCtx({ base = null, local = null } = {}) {
  const files = new Map();
  if (base !== null) files.set(BASE_PATH, JSON.stringify(base, null, 2));
  if (local !== null) files.set(LOCAL_PATH, JSON.stringify(local, null, 2));

  const fs = {
    readFileSync(filePath) {
      if (!files.has(filePath)) {
        const err = new Error(`ENOENT: ${filePath}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(filePath);
    },
    writeFileSync(filePath, contents) {
      files.set(filePath, contents);
    },
  };

  return {
    ctx: { projectRoot: PROJECT_ROOT, fs },
    read: (filePath) => JSON.parse(files.get(filePath)),
    exists: (filePath) => files.has(filePath),
  };
}

/**
 * @param {object} overrides
 * @returns {ReturnType<typeof createRetireAgentrcKeyStep>}
 */
function makeStep(overrides = {}) {
  return createRetireAgentrcKeyStep({
    version: '9.9.9',
    description: 'test step',
    keys: [{ path: ['planning', 'complexityGate', 'retired'], pruneDepth: 0 }],
    ...overrides,
  });
}

describe('createRetireAgentrcKeyStep — detect', () => {
  it('is true when the key is present in the base config', () => {
    const { ctx } = makeCtx({
      base: { planning: { complexityGate: { retired: 1 } } },
    });
    assert.equal(makeStep().detect(ctx), true);
  });

  it('is true when the key survives only in the local overlay', () => {
    const { ctx } = makeCtx({
      base: { planning: { complexityGate: { enabled: true } } },
      local: { planning: { complexityGate: { retired: 1 } } },
    });
    assert.equal(makeStep().detect(ctx), true);
  });

  it('ignores the overlay when the step sweeps the base only', () => {
    const { ctx } = makeCtx({
      base: { planning: { complexityGate: { enabled: true } } },
      local: { planning: { complexityGate: { retired: 1 } } },
    });
    const step = makeStep({ filenames: [AGENTRC_BASE_FILENAME] });
    assert.equal(step.detect(ctx), false);
  });

  it('is false for a clean config, an absent block, and no file at all', () => {
    const clean = makeCtx({
      base: { planning: { complexityGate: { enabled: true } } },
    });
    assert.equal(makeStep().detect(clean.ctx), false);

    const noBlock = makeCtx({ base: { project: { commands: {} } } });
    assert.equal(makeStep().detect(noBlock.ctx), false);

    const absent = makeCtx();
    assert.equal(makeStep().detect(absent.ctx), false);
  });

  it('is false when a path segment holds a non-object', () => {
    const { ctx } = makeCtx({ base: { planning: { complexityGate: 7 } } });
    assert.equal(makeStep().detect(ctx), false);
  });

  it('is true when any one of several declared keys is present', () => {
    const { ctx } = makeCtx({
      base: { delivery: { quality: { b: { two: 1 } } } },
    });
    const step = makeStep({
      keys: [
        { path: ['delivery', 'quality', 'a', 'one'], pruneDepth: 1 },
        { path: ['delivery', 'quality', 'b', 'two'], pruneDepth: 1 },
      ],
    });
    assert.equal(step.detect(ctx), true);
  });
});

describe('createRetireAgentrcKeyStep — prune depth', () => {
  it('pruneDepth 0 leaves the emptied container in place', () => {
    const { ctx, read } = makeCtx({
      base: { project: { commands: { retired: 'x' } } },
    });
    const step = makeStep({
      filenames: [AGENTRC_BASE_FILENAME],
      keys: [{ path: ['project', 'commands', 'retired'], pruneDepth: 0 }],
    });

    step.apply(ctx);

    const written = read(BASE_PATH);
    assert.deepEqual(written.project.commands, {});
  });

  it('pruneDepth 1 removes the emptied parent but stops there', () => {
    const { ctx, read } = makeCtx({
      base: { delivery: { quality: { guardrails: { retired: 1 } } } },
    });
    const step = makeStep({
      filenames: [AGENTRC_BASE_FILENAME],
      keys: [
        {
          path: ['delivery', 'quality', 'guardrails', 'retired'],
          pruneDepth: 1,
        },
      ],
    });

    step.apply(ctx);

    const written = read(BASE_PATH);
    assert.equal('guardrails' in written.delivery.quality, false);
    assert.deepEqual(written.delivery.quality, {});
  });

  it('pruneDepth 2 removes two emptied ancestors', () => {
    const { ctx, read } = makeCtx({
      base: { planning: { complexityGate: { retired: 1 } }, project: {} },
    });
    const step = makeStep({
      filenames: [AGENTRC_BASE_FILENAME],
      keys: [
        { path: ['planning', 'complexityGate', 'retired'], pruneDepth: 2 },
      ],
    });

    step.apply(ctx);

    const written = read(BASE_PATH);
    assert.equal('planning' in written, false);
    assert.deepEqual(written.project, {});
  });

  it('stops pruning at the first ancestor that still has siblings', () => {
    const { ctx, read } = makeCtx({
      base: {
        planning: { complexityGate: { retired: 1 }, riskHeuristics: ['x'] },
      },
    });
    const step = makeStep({
      filenames: [AGENTRC_BASE_FILENAME],
      keys: [
        { path: ['planning', 'complexityGate', 'retired'], pruneDepth: 2 },
      ],
    });

    step.apply(ctx);

    const written = read(BASE_PATH);
    assert.equal('complexityGate' in written.planning, false);
    assert.deepEqual(written.planning.riskHeuristics, ['x']);
  });
});

describe('createRetireAgentrcKeyStep — apply', () => {
  it('preserves sibling keys next to the retired one', () => {
    const { ctx, read } = makeCtx({
      base: {
        planning: { complexityGate: { retired: 1, enabled: true } },
        project: { commands: { typecheck: 'node --version' } },
      },
    });

    makeStep({ filenames: [AGENTRC_BASE_FILENAME] }).apply(ctx);

    const written = read(BASE_PATH);
    assert.deepEqual(written.planning.complexityGate, { enabled: true });
    assert.deepEqual(written.project.commands, { typecheck: 'node --version' });
  });

  it('strips every declared key in one pass', () => {
    const { ctx, read } = makeCtx({
      base: {
        delivery: {
          quality: { a: { one: 1, keep: true }, b: { two: 2 } },
        },
      },
    });
    const step = makeStep({
      filenames: [AGENTRC_BASE_FILENAME],
      keys: [
        { path: ['delivery', 'quality', 'a', 'one'], pruneDepth: 1 },
        { path: ['delivery', 'quality', 'b', 'two'], pruneDepth: 1 },
      ],
    });

    step.apply(ctx);

    const written = read(BASE_PATH);
    assert.deepEqual(written.delivery.quality.a, { keep: true });
    assert.equal('b' in written.delivery.quality, false);
  });

  it('sweeps both surfaces in one pass', () => {
    const { ctx, read } = makeCtx({
      base: { planning: { complexityGate: { retired: 1, enabled: true } } },
      local: { planning: { complexityGate: { retired: 2 } } },
    });

    makeStep().apply(ctx);

    assert.equal('retired' in read(BASE_PATH).planning.complexityGate, false);
    assert.equal(read(BASE_PATH).planning.complexityGate.enabled, true);
    assert.equal('retired' in read(LOCAL_PATH).planning.complexityGate, false);
  });

  it('leaves a clean surface untouched when only the other is dirty', () => {
    const { ctx, read } = makeCtx({
      base: { planning: { complexityGate: { enabled: true } } },
      local: { planning: { complexityGate: { retired: 1 } } },
    });

    makeStep().apply(ctx);

    // The base was never rewritten, so its formatting is byte-identical.
    assert.deepEqual(read(BASE_PATH), {
      planning: { complexityGate: { enabled: true } },
    });
  });

  it('does not create an absent overlay file', () => {
    const { ctx, exists } = makeCtx({
      base: { planning: { complexityGate: { retired: 1 } } },
    });

    makeStep().apply(ctx);

    assert.equal(exists(LOCAL_PATH), false);
  });

  it('is a no-op when there is no config on disk', () => {
    const { ctx } = makeCtx();
    assert.doesNotThrow(() => makeStep().apply(ctx));
  });

  it('satisfies the idempotency contract: detect is false after apply', () => {
    const { ctx } = makeCtx({
      base: { planning: { complexityGate: { retired: 1 } } },
      local: { planning: { complexityGate: { retired: 2 } } },
    });
    const step = makeStep();

    assert.equal(step.detect(ctx), true);
    step.apply(ctx);
    assert.equal(step.detect(ctx), false);

    assert.doesNotThrow(() => step.apply(ctx));
    assert.equal(step.detect(ctx), false);
  });

  it('writes trailing-newline-terminated pretty JSON', () => {
    const files = new Map();
    files.set(
      BASE_PATH,
      JSON.stringify({ planning: { complexityGate: { retired: 1 } } }),
    );
    const ctx = {
      projectRoot: PROJECT_ROOT,
      fs: {
        readFileSync: (p) => files.get(p),
        writeFileSync: (p, c) => files.set(p, c),
      },
    };

    makeStep({ filenames: [AGENTRC_BASE_FILENAME] }).apply(ctx);

    const raw = files.get(BASE_PATH);
    assert.equal(raw.endsWith('\n'), true);
    assert.equal(raw.includes('\n  '), true);
  });
});

describe('createRetireAgentrcKeyStep — surface', () => {
  it('carries the declared version and description', () => {
    const step = makeStep({ version: '2.40.0', description: 'strip thing' });
    assert.equal(step.version, '2.40.0');
    assert.equal(step.description, 'strip thing');
  });

  it('defaults to sweeping both config surfaces', () => {
    assert.deepEqual(
      [...AGENTRC_FILENAMES],
      [AGENTRC_BASE_FILENAME, AGENTRC_LOCAL_FILENAME],
    );
  });
});
