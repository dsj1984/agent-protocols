import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Unit tests for the resolve/create-project helper split inside
 * `providers/github/projects.js`. Story #816 broke `resolveOrCreateProject`
 * into three async helpers (resolveExistingProject, lookupOwnerNodeId,
 * createProjectForOwner) plus the orchestrator and a soft-degrade detector
 * (`isScopesMissingEnvelope`). The async helpers are exercised end-to-end
 * via the agents-bootstrap smoke; this file pins the pure detector that
 * gates every soft-degrade branch.
 */

import {
  createProjectForOwner,
  isScopesMissingEnvelope,
  lookupOwnerNodeId,
  resolveExistingProject,
  resolveOrCreateProject,
} from '../../.agents/scripts/providers/github/projects.js';

describe('isScopesMissingEnvelope', () => {
  it('detects { scopesMissing: true }', () => {
    assert.equal(isScopesMissingEnvelope({ scopesMissing: true }), true);
  });

  it('rejects null/undefined and primitive types', () => {
    assert.equal(isScopesMissingEnvelope(null), false);
    assert.equal(isScopesMissingEnvelope(undefined), false);
    assert.equal(isScopesMissingEnvelope('id-123'), false);
    assert.equal(isScopesMissingEnvelope(42), false);
    assert.equal(isScopesMissingEnvelope(true), false);
    assert.equal(isScopesMissingEnvelope(0), false);
    assert.equal(isScopesMissingEnvelope(''), false);
  });

  it('rejects objects without scopesMissing: true', () => {
    assert.equal(isScopesMissingEnvelope({}), false);
    assert.equal(isScopesMissingEnvelope({ scopesMissing: false }), false);
    assert.equal(isScopesMissingEnvelope({ id: 'P_1' }), false);
    assert.equal(isScopesMissingEnvelope({ scopesMissing: 'yes' }), false);
  });
});

describe('resolveOrCreateProject helper exports — public surface', () => {
  it('exports each split helper as an AsyncFunction', () => {
    for (const fn of [
      resolveExistingProject,
      lookupOwnerNodeId,
      createProjectForOwner,
      resolveOrCreateProject,
    ]) {
      assert.equal(typeof fn, 'function');
      assert.equal(
        fn.constructor.name,
        'AsyncFunction',
        `${fn.name} should be async`,
      );
    }
  });
});
