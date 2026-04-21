/**
 * Shared lazy verbose-logger for the dispatch-engine submodules.
 *
 * Deferring `VerboseLogger.init()` and `resolveConfig()` out of module scope
 * means importing any dispatch submodule never triggers filesystem reads or
 * `.env` loading. The proxy keeps `vlog.info(...)` / `vlog.warn(...)` call
 * sites unchanged; the first access materializes the real logger.
 */

import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { VerboseLogger } from '../VerboseLogger.js';

let _vlog = null;

export const vlog = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!_vlog) {
        const { settings } = resolveConfig();
        _vlog = VerboseLogger.init(settings, PROJECT_ROOT, {
          source: 'dispatcher',
        });
      }
      const value = _vlog[prop];
      return typeof value === 'function' ? value.bind(_vlog) : value;
    },
  },
);
