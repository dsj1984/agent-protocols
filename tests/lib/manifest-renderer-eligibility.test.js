import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Pin the eligibility predicates extracted from `postManifestEpicComment` /
 * `postParkedFollowOnsComment` (Story #816). The shared guard used to be
 * inlined twice, which inflated each upsert helper's cyclomatic complexity
 * past the CRAP cap. Tests here cover each branch the orchestrators delegate.
 */

import {
  classifyEpicCommentEligibility,
  isEpicManifest,
  providerCanPostComment,
} from '../../.agents/scripts/lib/presentation/manifest-renderer.js';

describe('isEpicManifest', () => {
  it('true for an epic-shaped manifest', () => {
    assert.equal(isEpicManifest({ type: 'epic-execution', epicId: 12 }), true);
  });

  it('false when manifest is missing or not an object', () => {
    assert.equal(isEpicManifest(null), false);
    assert.equal(isEpicManifest(undefined), false);
    assert.equal(isEpicManifest('not-an-object'), false);
    assert.equal(isEpicManifest(7), false);
  });

  it('false for story-execution dry-run manifests', () => {
    assert.equal(
      isEpicManifest({ type: 'story-execution', epicId: 12 }),
      false,
    );
  });

  it('false when epicId is missing/falsy', () => {
    assert.equal(isEpicManifest({ type: 'epic-execution' }), false);
    assert.equal(isEpicManifest({ type: 'epic-execution', epicId: 0 }), false);
    assert.equal(
      isEpicManifest({ type: 'epic-execution', epicId: null }),
      false,
    );
  });
});

describe('providerCanPostComment', () => {
  it('true when provider exposes a callable postComment', () => {
    assert.equal(providerCanPostComment({ postComment: () => {} }), true);
  });

  it('false when provider is null/undefined', () => {
    assert.equal(providerCanPostComment(null), false);
    assert.equal(providerCanPostComment(undefined), false);
  });

  it('false when postComment is missing or not callable', () => {
    assert.equal(providerCanPostComment({}), false);
    assert.equal(providerCanPostComment({ postComment: 'string' }), false);
    assert.equal(providerCanPostComment({ postComment: 42 }), false);
  });
});

describe('classifyEpicCommentEligibility', () => {
  it('returns null when both manifest and provider are eligible', () => {
    assert.equal(
      classifyEpicCommentEligibility({ epicId: 12 }, { postComment: () => {} }),
      null,
    );
  });

  it('returns "not-an-epic-manifest" when manifest is ineligible', () => {
    assert.equal(
      classifyEpicCommentEligibility(null, { postComment: () => {} }),
      'not-an-epic-manifest',
    );
    assert.equal(
      classifyEpicCommentEligibility(
        { type: 'story-execution', epicId: 1 },
        { postComment: () => {} },
      ),
      'not-an-epic-manifest',
    );
  });

  it('returns "no-provider" when manifest is eligible but provider cannot post', () => {
    assert.equal(
      classifyEpicCommentEligibility({ epicId: 12 }, null),
      'no-provider',
    );
    assert.equal(
      classifyEpicCommentEligibility({ epicId: 12 }, {}),
      'no-provider',
    );
  });
});
