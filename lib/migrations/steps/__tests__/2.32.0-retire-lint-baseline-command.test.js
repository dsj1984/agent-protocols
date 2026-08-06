// lib/migrations/steps/__tests__/2.32.0-retire-lint-baseline-command.test.js
/**
 * Unit tests for the Story #5004 follow-up migration step — strips the
 * retired `project.commands.lintBaseline` key from a consumer
 * `.agentrc.json`. All tests drive `detect`/`apply` against an in-memory
 * fake fs (testing-standards § Unit) — no real filesystem I/O.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { retireLintBaselineCommand } from '../2.32.0-retire-lint-baseline-command.js';

const PROJECT_ROOT = '/consumer';
const AGENTRC_PATH = path.join(PROJECT_ROOT, '.agentrc.json');

/**
 * @param {object | null} initialConfig - `null` means no file on disk.
 * @returns {{ ctx: object, readConfig: () => object }}
 */
function makeCtx(initialConfig) {
  const files = new Map();
  if (initialConfig !== null) {
    files.set(AGENTRC_PATH, JSON.stringify(initialConfig, null, 2));
  }

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
    readConfig: () => JSON.parse(files.get(AGENTRC_PATH)),
  };
}

describe('retireLintBaselineCommand — detect', () => {
  it('detects a config carrying project.commands.lintBaseline', () => {
    const { ctx } = makeCtx({
      project: { commands: { lintBaseline: 'npm run lint -- --format json' } },
    });
    assert.equal(retireLintBaselineCommand.detect(ctx), true);
  });

  it('does not detect a commands block without the key', () => {
    const { ctx } = makeCtx({
      project: { commands: { typecheck: 'tsc --noEmit' } },
    });
    assert.equal(retireLintBaselineCommand.detect(ctx), false);
  });

  it('does not detect an absent commands block or an absent config', () => {
    assert.equal(retireLintBaselineCommand.detect(makeCtx({}).ctx), false);
    assert.equal(retireLintBaselineCommand.detect(makeCtx(null).ctx), false);
  });
});

describe('retireLintBaselineCommand — apply', () => {
  it('removes the key and leaves the rest of the config intact', () => {
    const { ctx, readConfig } = makeCtx({
      project: {
        paths: { agentRoot: '.agents' },
        commands: { lintBaseline: 'npm run lint', typecheck: 'tsc --noEmit' },
      },
      delivery: { quality: { gates: { lint: { baselinePath: 'b.json' } } } },
    });
    retireLintBaselineCommand.apply(ctx);
    const config = readConfig();
    assert.equal(Object.hasOwn(config.project.commands, 'lintBaseline'), false);
    assert.equal(config.project.commands.typecheck, 'tsc --noEmit');
    assert.equal(config.project.paths.agentRoot, '.agents');
    // The `lint` baseline KIND survives — only the capture shell was retired.
    assert.equal(config.delivery.quality.gates.lint.baselinePath, 'b.json');
  });

  it('leaves an emptied commands block in place', () => {
    const { ctx, readConfig } = makeCtx({
      project: { commands: { lintBaseline: 'npm run lint' } },
    });
    retireLintBaselineCommand.apply(ctx);
    assert.deepEqual(readConfig().project.commands, {});
  });

  it('is idempotent — a second pass detects nothing', () => {
    const { ctx } = makeCtx({
      project: { commands: { lintBaseline: 'npm run lint' } },
    });
    retireLintBaselineCommand.apply(ctx);
    assert.equal(retireLintBaselineCommand.detect(ctx), false);
  });

  it('is a no-op when there is no config on disk', () => {
    const { ctx } = makeCtx(null);
    assert.doesNotThrow(() => retireLintBaselineCommand.apply(ctx));
  });
});
