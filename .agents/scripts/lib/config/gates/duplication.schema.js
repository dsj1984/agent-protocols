/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

import { gateBase, LIST_OR_EXTENDER_OF_STRINGS } from './shared.js';

export const DUPLICATION_GATE = {
  type: 'object',
  description:
    'Code-duplication (DRY) gate (Story #3664). Shares the gate base and adds the scan-scope extras: the `targetDirs` the duplication scanner walks, a bounded refresh timeout mirroring crap/MI, and `ignoreGlobs` to exclude files from the scan.',
  properties: {
    ...gateBase({
      enabled: false,
      baselinePath: 'baselines/duplication.json',
      tolerance: { kind: 'absolute', value: 1 },
      floors: { '*': { percentage: 25 } },
    }),
    targetDirs: {
      ...LIST_OR_EXTENDER_OF_STRINGS,
      description:
        "Directories whose JS sources the duplication (DRY) gate scans for copy-paste clones. Mandrel ships a `src/`-centric default; projects whose executable code lives elsewhere (e.g. this repo's `.agents/scripts/`) override here. The framework default is intentionally not auto-discovered, so an override is the explicit, auditable signal (Story #3664).",
      default: ['src'],
    },
    refreshTimeoutMs: {
      type: 'integer',
      minimum: 1,
      description:
        'Bounded timeout (ms) for `npm run duplication:update` spawned by the baseline-attribution refresh path. Mirrors `crap.refreshTimeoutMs` / `coverage.timeoutMs`: a SIGKILL fired at the budget boundary maps to exit 124. Default 60000 (Story #3664).',
      default: 60000,
    },
    ignoreGlobs: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description:
        'Minimatch glob patterns matched against the canonicalised repo-relative path of each discovered file. Files matching any pattern are excluded from duplication discovery before scanning. Orthogonal to `components` (grouping). Absent or empty preserves the existing behaviour (Story #3664).',
      default: [],
    },
  },
  additionalProperties: false,
};
