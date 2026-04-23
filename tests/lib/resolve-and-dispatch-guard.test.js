/**
 * resolveAndDispatch: conflicting type-label guard (AC-03).
 *
 * A ticket carrying more than one `type::*` label is ambiguous — the dispatcher
 * must refuse to execute rather than silently pick a branch.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConflictingTypeLabelsError } from '../../.agents/scripts/lib/errors/index.js';
import { resolveAndDispatch } from '../../.agents/scripts/lib/orchestration/dispatch-engine.js';
import { MockProvider } from '../fixtures/mock-provider.js';

describe('resolveAndDispatch — conflicting type-label guard', () => {
  it('throws ConflictingTypeLabelsError when ticket has both type::epic and type::story', async () => {
    const provider = new MockProvider({
      tickets: {
        42: {
          id: 42,
          labels: ['type::epic', 'type::story'],
          body: '',
          state: 'open',
        },
      },
    });

    await assert.rejects(
      () => resolveAndDispatch({ ticketId: 42, provider, dryRun: true }),
      (err) => {
        assert.ok(
          err instanceof ConflictingTypeLabelsError,
          `expected ConflictingTypeLabelsError, got ${err.constructor.name}`,
        );
        assert.match(err.message, /#42/);
        assert.match(err.message, /type::epic/);
        assert.match(err.message, /type::story/);
        return true;
      },
    );
  });
});
