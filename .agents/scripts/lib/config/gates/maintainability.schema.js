/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

import { MAINTAINABILITY_GATE_DEFAULTS } from '../quality.js';
import {
  gateBase,
  LIST_OR_EXTENDER_OF_STRINGS,
  SAFE_STRING,
} from './shared.js';

export const MAINTAINABILITY_GATE = {
  type: 'object',
  description:
    'Maintainability-index ratchet. Scores per file as the average over its methods, so deleting a small high-MI method can legitimately lower a file’s score.',
  properties: {
    ...gateBase({
      enabled: MAINTAINABILITY_GATE_DEFAULTS.enabled,
      baselinePath: MAINTAINABILITY_GATE_DEFAULTS.baselinePath,
      tolerance: MAINTAINABILITY_GATE_DEFAULTS.tolerance,
      floors: MAINTAINABILITY_GATE_DEFAULTS.floors,
    }),
    targetDirs: {
      ...LIST_OR_EXTENDER_OF_STRINGS,
      description:
        "Directories whose JS sources the maintainability gate scores. Mandrel ships a `src/`-centric default; projects whose executable code lives elsewhere (e.g. this repo's `.agents/scripts/` plus `tests/`) override here. The framework default is intentionally not auto-discovered, so an override is the explicit, auditable signal.",
      default: [...MAINTAINABILITY_GATE_DEFAULTS.targetDirs],
    },
    // Story #4731 — commit-subject substring that acknowledges a deliberate
    // maintainability baseline refresh in the compared range.
    refreshTag: {
      ...SAFE_STRING,
      minLength: 1,
      description:
        "Commit-subject substring that acknowledges a deliberate maintainability baseline refresh in the compared range. Mirrors the CRAP gate's `refreshTag`; a range commit carrying it that touches the baseline file demotes head-vs-base regressions (floors still enforced).",
    },
    refreshTimeoutMs: {
      type: 'integer',
      minimum: 1,
      description:
        'Bounded timeout (ms) for `npm run maintainability:update` spawned by the baseline-attribution refresh path. Mirrors `coverage.timeoutMs`: a SIGKILL fired at the budget boundary maps to exit 124 so the close orchestrator can flip the Story to `agent::blocked`. Default 60000 (Story #2165).',
      default: MAINTAINABILITY_GATE_DEFAULTS.refreshTimeoutMs,
    },
    ignoreGlobs: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description:
        'Minimatch glob patterns matched against the canonicalised repo-relative path of each discovered file. Files matching any pattern are excluded from MI discovery before scoring. Orthogonal to `components` (grouping) — a file excluded here never appears in any component bucket. Absent or empty preserves the existing IGNORED_DIRS-only behaviour (Story #3217).',
      default: [...MAINTAINABILITY_GATE_DEFAULTS.ignoreGlobs],
    },
  },
  additionalProperties: false,
};
