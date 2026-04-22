import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildIntentNotificationBody,
  checkVersionBumpIntent,
  detectIntentMismatch,
  parseVersionBumpIntent,
  VERSION_BUMP_INTENT_MARKER,
} from '../../.agents/scripts/lib/orchestration/epic-runner/version-bump-intent.js';

function createFakeProvider() {
  let autoId = 1;
  const comments = new Map();
  return {
    _comments: comments,
    async getTicketComments(ticketId) {
      return comments.get(ticketId) ?? [];
    },
    async postComment(ticketId, payload) {
      const list = comments.get(ticketId) ?? [];
      const comment = {
        id: autoId++,
        body: payload.body,
        type: payload.type,
      };
      list.push(comment);
      comments.set(ticketId, list);
      return comment;
    },
  };
}

describe('parseVersionBumpIntent', () => {
  it('returns no directive for empty or plain bodies', () => {
    assert.deepEqual(parseVersionBumpIntent('').hasDirective, false);
    assert.deepEqual(
      parseVersionBumpIntent('Just an epic body with no directives.')
        .hasDirective,
      false,
    );
  });

  it('parses `Release target: vX.Y.Z (segment)`', () => {
    const intent = parseVersionBumpIntent(
      'Some preamble.\nRelease target: v5.15.3 (patch)\nMore text.',
    );
    assert.equal(intent.hasDirective, true);
    assert.equal(intent.target, 'v5.15.3');
    assert.equal(intent.segment, 'patch');
    assert.ok(intent.sources.includes('release-target'));
  });

  it('parses `--segment` flag', () => {
    const intent = parseVersionBumpIntent('Run with --segment minor please.');
    assert.equal(intent.hasDirective, true);
    assert.equal(intent.segment, 'minor');
    assert.ok(intent.sources.includes('segment-flag'));
  });
});

describe('detectIntentMismatch', () => {
  it('no-op when no directive present', () => {
    const intent = parseVersionBumpIntent('plain body');
    const { mismatch } = detectIntentMismatch({
      intent,
      autoVersionBump: false,
    });
    assert.equal(mismatch, false);
  });

  it('agrees when directive present and autoVersionBump=true', () => {
    const intent = parseVersionBumpIntent('Release target: v5.15.3 (patch)');
    const { mismatch } = detectIntentMismatch({
      intent,
      autoVersionBump: true,
    });
    assert.equal(mismatch, false);
  });

  it('flags mismatch when directive present but autoVersionBump=false', () => {
    const intent = parseVersionBumpIntent('Release target: v5.15.3 (patch)');
    const { mismatch, reason } = detectIntentMismatch({
      intent,
      autoVersionBump: false,
    });
    assert.equal(mismatch, true);
    assert.match(reason, /autoVersionBump/);
  });

  it('flags mismatch when release-target segment conflicts with --segment flag', () => {
    const intent = parseVersionBumpIntent(
      'Release target: v5.15.3 (patch)\nRun with --segment minor.',
    );
    const { mismatch, reason } = detectIntentMismatch({
      intent,
      autoVersionBump: true,
    });
    assert.equal(mismatch, true);
    assert.match(reason, /conflicting segments/);
  });
});

describe('buildIntentNotificationBody', () => {
  it('embeds the sub-variant marker', () => {
    const intent = parseVersionBumpIntent('Release target: v5.15.3 (patch)');
    const body = buildIntentNotificationBody({
      intent,
      autoVersionBump: false,
      reason: 'mismatch explanation',
    });
    assert.ok(body.includes(VERSION_BUMP_INTENT_MARKER));
    assert.match(body, /mismatch explanation/);
    assert.match(body, /autoVersionBump/);
  });
});

describe('checkVersionBumpIntent', () => {
  it('no-op when epic body has no directive', async () => {
    const provider = createFakeProvider();
    const res = await checkVersionBumpIntent({
      provider,
      epicId: 441,
      epicBody: 'plain body, no directive',
      autoVersionBump: false,
    });
    assert.equal(res.mismatch, false);
    assert.equal(res.emitted, false);
    assert.equal((provider._comments.get(441) ?? []).length, 0);
  });

  it('no-op when intent and config agree', async () => {
    const provider = createFakeProvider();
    const res = await checkVersionBumpIntent({
      provider,
      epicId: 441,
      epicBody: 'Release target: v5.15.3 (patch)',
      autoVersionBump: true,
    });
    assert.equal(res.mismatch, false);
    assert.equal(res.emitted, false);
    assert.equal((provider._comments.get(441) ?? []).length, 0);
  });

  it('emits `notification` comment when intent disagrees with config', async () => {
    const provider = createFakeProvider();
    const res = await checkVersionBumpIntent({
      provider,
      epicId: 441,
      epicBody: 'Release target: v5.15.3 (patch)',
      autoVersionBump: false,
    });
    assert.equal(res.mismatch, true);
    assert.equal(res.emitted, true);
    const comments = provider._comments.get(441) ?? [];
    assert.equal(comments.length, 1);
    assert.equal(comments[0].type, 'notification');
    assert.ok(comments[0].body.includes(VERSION_BUMP_INTENT_MARKER));
  });

  it('dedupes on the sub-variant marker across re-runs', async () => {
    const provider = createFakeProvider();
    const args = {
      provider,
      epicId: 441,
      epicBody: 'Release target: v5.15.3 (patch)',
      autoVersionBump: false,
    };
    const first = await checkVersionBumpIntent(args);
    assert.equal(first.emitted, true);
    const second = await checkVersionBumpIntent(args);
    assert.equal(second.mismatch, true);
    assert.equal(second.emitted, false, 'should not re-post on resume');
    const comments = provider._comments.get(441) ?? [];
    assert.equal(comments.length, 1);
  });
});
