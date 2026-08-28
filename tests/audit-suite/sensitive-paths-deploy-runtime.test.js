// tests/audit-suite/sensitive-paths-deploy-runtime.test.js
//
// Regression pin for the gap filed as #5069.
//
// `sensitivePaths` shipped five classes — security, data-migration, billing,
// destructive-mutation, public-api — and no deployment class, so every
// deploy-critical surface derived `level: 'low'` in `deriveChangeLevel`, which
// routes `resolveCeremonyForRisk` to an inline self-eval and `resolveDepth` to
// `light`. The files most able to break production got the lightest tier.
//
// The trap that hid it: `audits['audit-devops'].triggers.filePatterns` DOES
// register `.github/workflows/**`, `**/Dockerfile`, `infra/**` and `**/*.tf` —
// but that block selects WHICH LENS RUNS. `deriveChangeLevel` reads a
// different block, `sensitivePaths`, through `selectSensitivePathClasses`.
// Reading the manifest casually suggests deploy paths are covered; they were
// covered for lens selection and not at all for change-level derivation.
//
// These tests therefore assert against the SHIPPED manifest on disk, not an
// injected fixture. `review-depth.test.js` pins the derivation's control flow
// with a stand-in manifest and is deliberately I/O-free; that is the right
// shape for the algorithm, but it is exactly why a missing class in the real
// manifest stayed invisible. The invariant here is about what we ship.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveChangeLevel } from '../../.agents/scripts/lib/orchestration/review-depth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RULES_PATH = path.join(
  REPO_ROOT,
  '.agents',
  'schemas',
  'audit-rules.json',
);

/** The shipped manifest — the artifact under test, not a fixture. */
const SHIPPED = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

/** Derive against the shipped manifest, bypassing the memoized disk read. */
function levelOf(changedFiles) {
  return deriveChangeLevel({ changedFiles, injectedRules: SHIPPED });
}

/**
 * One representative path per deployment surface the class claims. Each is a
 * change that can break production on its own without touching application
 * logic.
 */
const DEPLOY_SURFACES = [
  ['CI workflow', '.github/workflows/deploy-production.yml'],
  ['composite action', '.github/actions/setup-db/action.yml'],
  ['container image', 'Dockerfile'],
  ['compose topology', 'docker-compose.prod.yml'],
  ['IaC tree', 'infra/uptime/monitors.json'],
  ['terraform module', 'infra/dns/main.tf'],
  ['terraform vars', 'infra/dns/prod.tfvars'],
  ['wrangler config (jsonc)', 'apps/web/wrangler.jsonc'],
  ['wrangler config (toml)', 'wrangler.toml'],
  ['worker entrypoint', 'apps/web/src/worker-entry.ts'],
  ['astro build config', 'apps/web/astro.config.ts'],
  ['next build config', 'next.config.mjs'],
  ['fly topology', 'fly.toml'],
  ['vercel topology', 'vercel.json'],
  ['serverless topology', 'serverless.yml'],
];

describe('sensitivePaths ships a deployment class (#5069)', () => {
  test('the deploy-runtime class is registered in the shipped manifest', () => {
    const cls = SHIPPED.sensitivePaths?.['deploy-runtime'];
    assert.ok(
      cls,
      'sensitivePaths must register deploy-runtime — without it every CI, IaC, and entrypoint change derives low and routes to an inline self-eval',
    );
    assert.ok(Array.isArray(cls.filePatterns) && cls.filePatterns.length > 0);
  });

  for (const [label, file] of DEPLOY_SURFACES) {
    test(`${label} (${file}) derives high`, () => {
      const { level, classes } = levelOf([file]);
      assert.equal(
        level,
        'high',
        `${file} must derive high — a deploy-critical change may not buy the lightest review tier`,
      );
      assert.ok(
        classes.includes('deploy-runtime'),
        `${file} must be attributed to deploy-runtime, got ${JSON.stringify(classes)}`,
      );
    });
  }

  test('a deploy change earns high however narrow the diff is', () => {
    // The load-bearing case: one file, no application logic, still deep.
    const { level } = levelOf(['apps/web/wrangler.jsonc']);
    assert.equal(level, 'high');
  });
});

describe('deploy-runtime stays narrow — the light tier must survive', () => {
  // A class that matches everything would flip every change set to high and
  // make `light` unreachable, which is the same failure in the other
  // direction: ceremony that no longer discriminates is ceremony nobody reads.
  const ORDINARY = [
    'README.md',
    'docs/architecture.md',
    'src/components/Button.tsx',
    'src/lib/format-date.ts',
    'packages/shared/src/types/lead.ts',
  ];

  for (const file of ORDINARY) {
    test(`${file} is not deploy-sensitive`, () => {
      const { classes } = levelOf([file]);
      assert.ok(
        !classes.includes('deploy-runtime'),
        `${file} must not match deploy-runtime`,
      );
    });
  }

  test('test and lint configs are not deploy-sensitive', () => {
    // The reason build configs are enumerated by name: a blanket
    // `**/*.config.*` glob would swallow these and defeat the light tier.
    for (const file of [
      'vitest.config.ts',
      'playwright.config.ts',
      'eslint.config.mjs',
      'tailwind.config.js',
    ]) {
      const { classes } = levelOf([file]);
      assert.ok(
        !classes.includes('deploy-runtime'),
        `${file} must not match deploy-runtime — it is not a deployment surface`,
      );
    }
  });

  test('a colocated entrypoint test is not the entrypoint', () => {
    // `**/worker-entry.ts` is exact so it does not catch the sibling specs
    // that change far more often than the entrypoint itself.
    for (const file of [
      'apps/web/src/worker-entry.test.ts',
      'apps/web/src/worker-entry.sms.test.ts',
    ]) {
      const { classes } = levelOf([file]);
      assert.ok(
        !classes.includes('deploy-runtime'),
        `${file} must not match deploy-runtime`,
      );
    }
  });
});
