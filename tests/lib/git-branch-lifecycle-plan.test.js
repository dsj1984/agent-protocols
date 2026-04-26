import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Pin the four-way action planner extracted from `ensureEpicBranchRef`
 * (Story #816). The orchestrator used to inline the local/remote presence
 * checks across three nested `if`s; pulling them into a pure planner keeps
 * the orchestrator's cyclomatic complexity under the CRAP cap and lets us
 * test every branch combination without driving git.
 */

import { planEnsureEpicBranchRefAction } from '../../.agents/scripts/lib/git-branch-lifecycle.js';

describe('planEnsureEpicBranchRefAction', () => {
  it('returns noop when both local and remote refs exist', () => {
    assert.equal(planEnsureEpicBranchRefAction(true, true), 'noop');
  });

  it('returns fetch when only the remote ref exists', () => {
    assert.equal(planEnsureEpicBranchRefAction(false, true), 'fetch');
  });

  it('returns publish-existing when only the local ref exists', () => {
    assert.equal(
      planEnsureEpicBranchRefAction(true, false),
      'publish-existing',
    );
  });

  it('returns create-and-publish when neither ref exists', () => {
    assert.equal(
      planEnsureEpicBranchRefAction(false, false),
      'create-and-publish',
    );
  });
});
