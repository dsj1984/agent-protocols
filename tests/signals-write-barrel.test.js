import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendSignal as observabilityAppendSignal,
  forEachLine as observabilityForEachLine,
} from '../.agents/scripts/lib/observability/signals-writer.js';
import {
  appendSignal as barrelAppendSignal,
  forEachLine as barrelForEachLine,
  schema,
} from '../.agents/scripts/lib/signals/index.js';
import {
  appendSignal as writeAppendSignal,
  forEachLine as writeForEachLine,
} from '../.agents/scripts/lib/signals/write.js';

/**
 * Story #1476 — `lib/signals/` re-exports the writer surface so new
 * code can converge on one barrel. The implementation still lives in
 * `lib/observability/signals-writer.js`; the re-export must point at the same
 * function objects so behaviour is literally identical and tests/mocks that
 * swap the implementation by reference work transparently.
 *
 * Story #5003 removed `appendTrace` (its only producer, the tool-trace hook,
 * went with it) and the `read` / `buildSpanTree` reader half (the
 * `signals-view.js` viewer that consumed them walked a `run-<id>/` layout no
 * v2 writer populates). The barrel is now a write-plus-schema surface, and
 * this test pins that shape so a reader half cannot be re-exported without a
 * live consumer.
 */

describe('lib/signals/write.js — writer re-export', () => {
  it('appendSignal is identity-equal to the observability writer', () => {
    assert.equal(writeAppendSignal, observabilityAppendSignal);
  });
  it('forEachLine is identity-equal to the observability writer', () => {
    assert.equal(writeForEachLine, observabilityForEachLine);
  });
});

describe('lib/signals/index.js — barrel surface', () => {
  it('exposes the writer surface via the barrel', () => {
    assert.equal(barrelAppendSignal, observabilityAppendSignal);
    assert.equal(barrelForEachLine, observabilityForEachLine);
  });

  it('keeps the schema export', () => {
    assert.equal(typeof schema, 'object');
  });

  it('exposes no reader or trace surface', async () => {
    const barrel = await import('../.agents/scripts/lib/signals/index.js');
    for (const gone of ['read', 'buildSpanTree', 'appendTrace']) {
      assert.equal(
        barrel[gone],
        undefined,
        `expected '${gone}' to be gone from the barrel (Story #5003)`,
      );
    }
  });
});
