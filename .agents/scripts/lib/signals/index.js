/**
 * `lib/signals/` barrel.
 *
 * Consumers do `import { schema, appendSignal } from './lib/signals/index.js'`
 * (or `import * as signals from './lib/signals/index.js'`) so a future
 * shape migration only has to touch this file.
 *
 * History:
 *   - Epic #1181 / Story #1438 / Task #1459 — initial barrel with `read`
 *     + `schema`; `buildSpanTree` was a throwing placeholder.
 *   - Epic #1181 / Story #1440 / Task #1461 — placeholder replaced by
 *     the real span-tree builder.
 *   - Story #1476 — `appendSignal` / `appendTrace` re-exported here
 *     via `./write.js` so the gate scripts (and any
 *     new code) converge on `lib/signals/` instead of importing the
 *     writer directly from `lib/observability/`.
 *   - Story #5003 — the reader half (`read`, `buildSpanTree`) went with the
 *     debug viewer that consumed it: it walked a `run-<id>/` layout no v2
 *     writer populates. `appendTrace` went with the trace hook, its only
 *     producer. What remains is the live write surface.
 *
 * @module lib/signals
 */

import * as schema from './schema.js';
import { appendSignal, forEachLine } from './write.js';

export { appendSignal, forEachLine, schema };
