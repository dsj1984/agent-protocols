/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

import { gateBase } from './shared.js';

export const LINT_GATE = {
  type: 'object',
  description:
    'Lint-count ratchet. Floors are absolute error/warning counts; the baseline pins the current count so a regression is visible even while the floor is not yet met.',
  properties: {
    ...gateBase({
      enabled: true,
      baselinePath: 'baselines/lint.json',
      tolerance: { kind: 'absolute', value: 0 },
      floors: { '*': { errorCount: 0 } },
    }),
  },
  additionalProperties: false,
};
