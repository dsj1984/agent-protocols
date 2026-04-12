import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Volume } from 'memfs';
import { ensureDirSync } from '../../.agents/scripts/lib/fs-utils.js';
import { setupFsMock } from './fs-mock.js';

describe('fs-utils', () => {
  let vol;

  beforeEach((t) => {
    vol = new Volume();
    setupFsMock(t, vol);
  });

  it('creates a single directory', () => {
    ensureDirSync('/testdir');
    assert.ok(vol.existsSync('/testdir'));
  });

  it('creates nested directories recursively', () => {
    ensureDirSync('/testdir/nested/deep');
    assert.ok(vol.existsSync('/testdir/nested/deep'));
  });

  it('does not throw if directory already exists', () => {
    vol.mkdirSync('/existing', { recursive: true });
    assert.doesNotThrow(() => {
      ensureDirSync('/existing');
    });
    assert.ok(vol.existsSync('/existing'));
  });
});
