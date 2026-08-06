/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

import { gateBase, NULLABLE_NONEMPTY_SAFE_STRING } from './shared.js';

const LIGHTHOUSE_ROUTE = {
  type: 'object',
  description: 'One route the Lighthouse run scores.',
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      description: 'Route path appended to `baseUrl`.',
    },
    formFactor: {
      type: 'string',
      enum: ['mobile', 'desktop'],
      description: 'Emulated form factor for this route.',
    },
  },
  additionalProperties: false,
};

export const LIGHTHOUSE_GATE = {
  type: 'object',
  description:
    'Lighthouse category-score ratchet for web targets. Off by default — it needs a running deployment.',
  properties: {
    ...gateBase({
      enabled: false,
      baselinePath: 'baselines/lighthouse.json',
      tolerance: { kind: 'absolute', value: 0 },
      floors: {
        '*': { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 },
      },
    }),
    baseUrl: {
      ...NULLABLE_NONEMPTY_SAFE_STRING,
      description:
        'Origin the routes are resolved against. `null` leaves the gate unusable, which is why it ships disabled.',
      default: null,
    },
    routes: {
      type: 'array',
      items: LIGHTHOUSE_ROUTE,
      description: 'Routes to score on each run.',
      default: [],
    },
  },
  additionalProperties: false,
};
