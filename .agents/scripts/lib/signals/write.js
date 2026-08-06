/**
 * `lib/signals/write.js` — thin re-export of the signals writer.
 *
 * The real implementation lives at `../observability/signals-writer.js`
 * (Epic #1030 / Story #1041). This module exists so callers can converge
 * on `lib/signals/` for the write surface. New code should
 * `import { appendSignal } from './lib/signals/index.js'` (or
 * `'./lib/signals/write.js'` for a narrower import); legacy direct imports
 * from `lib/observability/` keep working unchanged.
 *
 * `appendTrace` was removed in Story #5003 together with the tool-trace
 * hook — its only producer — and the viewer that was its only reader.
 */

export {
  appendSignal,
  forEachLine,
} from '../observability/signals-writer.js';
