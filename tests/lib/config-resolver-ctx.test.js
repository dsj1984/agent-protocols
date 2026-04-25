import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveConfig } from '../../.agents/scripts/lib/config-resolver.js';
import { createRuntimeContext } from '../../.agents/scripts/lib/runtime-context.js';

describe('resolveConfig with injected ctx.fs', () => {
  it('reads .agentrc.json through ctx.fs when a runtime context is passed', () => {
    const fakeRoot = path.resolve('/fake/ctx-root');
    const agentrcPath = path.join(fakeRoot, '.agentrc.json');
    const reads = [];
    const fakeFs = {
      existsSync: (p) => p === agentrcPath,
      readFileSync: (p) => {
        reads.push(p);
        return JSON.stringify({
          agentSettings: {
            paths: {
              agentRoot: '.agents',
              docsRoot: 'docs',
              tempRoot: 'temp',
            },
            baseBranch: 'develop',
          },
        });
      },
    };
    const ctx = createRuntimeContext({ fs: fakeFs });

    const resolved = resolveConfig({
      cwd: fakeRoot,
      bustCache: true,
      ctx,
    });

    assert.equal(resolved.source, agentrcPath);
    assert.equal(resolved.settings.baseBranch, 'develop');
    assert.deepEqual(reads, [agentrcPath]);
  });

  it('falls back to zero-config defaults when ctx.fs reports the file is missing', () => {
    const fakeRoot = path.resolve('/fake/empty-root');
    const fakeFs = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not read');
      },
    };
    const ctx = createRuntimeContext({ fs: fakeFs });

    const resolved = resolveConfig({
      cwd: fakeRoot,
      bustCache: true,
      ctx,
    });

    assert.equal(resolved.source, 'built-in defaults');
    assert.equal(resolved.orchestration, null);
    // `paths.agentRoot` is no longer a zero-config default — schema-required
    // keys are not silently filled in. Other zero-config keys still default.
    assert.equal(resolved.settings.paths.agentRoot, undefined);
    assert.equal(resolved.settings.scriptsRoot, '.agents/scripts');
  });
});
