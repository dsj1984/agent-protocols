/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

import { gateBase } from './shared.js';

const BUNDLE_DECLARATION = {
  type: 'object',
  description: 'One built artifact the bundle-size gate weighs.',
  required: ['name', 'path', 'limit'],
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      description: 'Label the rollup row is keyed by.',
    },
    path: {
      type: 'string',
      minLength: 1,
      description: 'Glob or path of the built artifact to measure.',
    },
    limit: {
      type: 'string',
      minLength: 1,
      description: 'Human size ceiling (e.g. `"180 kB"`).',
    },
  },
  additionalProperties: false,
};

export const BUNDLE_SIZE_GATE = {
  type: 'object',
  description:
    'Built-artifact size ratchet for web targets. Off by default — it needs declared bundles.',
  properties: {
    ...gateBase({
      enabled: false,
      baselinePath: 'baselines/bundle-size.json',
      tolerance: { kind: 'percent', value: 0 },
      floors: { '*': {} },
    }),
    bundles: {
      type: 'array',
      items: BUNDLE_DECLARATION,
      description:
        'The artifacts to weigh. Empty means the gate has nothing to do.',
      default: [],
    },
  },
  additionalProperties: false,
};
