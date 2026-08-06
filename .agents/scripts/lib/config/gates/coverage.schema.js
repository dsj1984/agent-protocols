/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

import { COVERAGE_GATE_DEFAULTS } from '../quality.js';
import { gateBase, SAFE_STRING } from './shared.js';

export const COVERAGE_GATE = {
  type: 'object',
  description:
    'Line/branch/function coverage ratchet, read from the Istanbul JSON summary the project test run emits.',
  properties: {
    ...gateBase({
      enabled: COVERAGE_GATE_DEFAULTS.enabled,
      baselinePath: COVERAGE_GATE_DEFAULTS.baselinePath,
      tolerance: COVERAGE_GATE_DEFAULTS.tolerance,
      floors: COVERAGE_GATE_DEFAULTS.floors,
    }),
    coveragePath: {
      ...SAFE_STRING,
      minLength: 1,
      description:
        'Repo-relative path to the Istanbul `coverage-final.json` the capture step writes and the gate reads.',
      default: COVERAGE_GATE_DEFAULTS.coveragePath,
    },
    // Story #2136 / Task #2142 — bounded timeout for `npm run test:coverage`.
    // Wired into `runCapture` via `spawnSync({ timeout, killSignal })`. A
    // SIGKILL fired by the timeout is translated to exit code 124 (the GNU
    // `timeout` convention) so close-validation can branch on "hang" vs.
    // "test failed".
    timeoutMs: {
      type: 'integer',
      minimum: 1,
      description:
        'Bounded timeout (ms) for the `npm run test:coverage` capture spawn. A SIGKILL at the budget boundary maps to exit 124 so close-validation can tell a hang from a test failure.',
      default: COVERAGE_GATE_DEFAULTS.timeoutMs,
    },
  },
  additionalProperties: false,
};
