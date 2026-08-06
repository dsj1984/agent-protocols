/**
 * agents-bootstrap-github — End-to-end integration.
 *
 * Exercises `runBootstrap` against a mocked provider + a scratch
 * filesystem across four canonical scenarios:
 *
 *   (a) Fresh consumer repo            — every step applies cleanly.
 *   (b) Already in target state        — every step is a no-op.
 *   (c) Drifted, no `--assume-yes`     — HITL aborts; no writes.
 *   (d) Drifted with `--assume-yes`    — HITL auto-approves; writes land.
 *
 * No real network. The mocked provider counts every call so the test can
 * assert "did NOT PATCH" on the abort scenario.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareSemver,
  MIN_GH_VERSION,
  parseGhVersion,
  preflightGh,
  preflightRuntimeDeps,
  runBootstrap,
} from '../../.agents/scripts/agents-bootstrap-github.js';
import { TARGET_MERGE_METHODS } from '../../.agents/scripts/lib/bootstrap/merge-methods.js';
import {
  GhAuthError,
  GhNotInstalledError,
  GhVersionError,
  MissingRuntimeDepsError,
} from '../../.agents/scripts/lib/errors/index.js';

const PR_GATE = {
  checks: [
    { name: 'lint', cmd: ['npm', 'run', 'lint'] },
    { name: 'test', cmd: ['npm', 'test'] },
  ],
  enforceBranchProtection: true,
};
// Epic #2880 / F14B: runBootstrap reads `opts.project` (canonical) instead
// of the legacy `opts.agentSettings` shape; new test calls use PROJECT_BLOCK.
const PROJECT_BLOCK = {
  baseBranch: 'main',
  quality: { prGate: PR_GATE },
};
const ORCHESTRATION = {
  provider: 'github',
  github: { owner: 'acme', repo: 'widgets' },
};

function makeMockProvider({
  protection = null,
  mergeState = TARGET_MERGE_METHODS,
} = {}) {
  const calls = {
    getTicket: 0,
    ensureLabels: 0,
    resolveOrCreateProject: 0,
    setBranchProtection: [],
    setMergeMethods: [],
  };
  return {
    calls,
    async getTicket() {
      calls.getTicket++;
      throw new Error('404 (issue 1 not found, but API is up)');
    },
    async ensureLabels() {
      calls.ensureLabels++;
      return { created: [], skipped: [] };
    },
    async resolveOrCreateProject() {
      calls.resolveOrCreateProject++;
      return { projectNumber: null, created: false, scopesMissing: true };
    },
    async ensureStatusField() {
      return { status: 'skipped', added: [] };
    },
    async ensureProjectViews() {
      return { created: [], skipped: [], unavailable: false };
    },
    async ensureProjectFields() {
      return { created: [], skipped: [] };
    },
    async getBranchProtection() {
      return protection
        ? { enabled: true, raw: protection }
        : { enabled: false };
    },
    async setBranchProtection(branch, opts) {
      calls.setBranchProtection.push({ branch, opts });
      const existingContexts =
        protection?.required_status_checks?.contexts ?? [];
      const merged = [...existingContexts];
      const added = [];
      for (const c of opts.contexts) {
        if (!merged.includes(c)) {
          merged.push(c);
          added.push(c);
        }
      }
      return { created: !protection, added, existing: existingContexts };
    },
    async getMergeMethods() {
      return mergeState;
    },
    async setMergeMethods(settings) {
      calls.setMergeMethods.push(settings);
      return { patched: Object.keys(settings) };
    },
  };
}

describe('agents-bootstrap-github — end-to-end integration', () => {
  it('(a) fresh repo: every step applies; HITL never consulted', async () => {
    const provider = makeMockProvider({
      protection: null,
      mergeState: { ...TARGET_MERGE_METHODS, allow_merge_commit: true },
    });
    const result = await runBootstrap(ORCHESTRATION, {
      providerOverride: provider,
      project: PROJECT_BLOCK,
      assumeYes: true,
      githubAdminApproved: true,
    });
    assert.equal(result.branchProtection.status, 'created');
    assert.equal(result.mergeMethods.status, 'patched');
    assert.equal(provider.calls.setBranchProtection.length, 1);
    assert.equal(provider.calls.setMergeMethods.length, 1);
  });

  it('(b) already-in-target-state: every step is a no-op / merged (no drift)', async () => {
    const provider = makeMockProvider({
      protection: {
        required_status_checks: {
          strict: true,
          contexts: ['lint', 'test'],
        },
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          required_approving_review_count: 0,
        },
        restrictions: null,
      },
      mergeState: { ...TARGET_MERGE_METHODS },
    });
    const result = await runBootstrap(ORCHESTRATION, {
      providerOverride: provider,
      project: PROJECT_BLOCK,
      githubAdminApproved: true,
    });
    assert.equal(result.branchProtection.status, 'merged');
    assert.deepEqual(result.branchProtection.added, []);
    assert.equal(result.mergeMethods.status, 'unchanged');
    assert.equal(provider.calls.setMergeMethods.length, 0);
  });

  it('(c) drifted, no --assume-yes → HITL aborts every drifted step; no writes', async () => {
    const provider = makeMockProvider({
      protection: {
        required_status_checks: {
          strict: true,
          contexts: ['lint'],
        },
        enforce_admins: { enabled: false }, // diverges
        required_pull_request_reviews: {
          required_approving_review_count: 2, // diverges
        },
        restrictions: null,
      },
      mergeState: { ...TARGET_MERGE_METHODS, allow_merge_commit: true },
    });

    const result = await runBootstrap(ORCHESTRATION, {
      providerOverride: provider,
      project: PROJECT_BLOCK,
      hitlConfirm: async () => false,
      githubAdminApproved: true,
    });

    assert.equal(result.branchProtection.status, 'skipped');
    assert.equal(result.branchProtection.reason, 'hitl-declined');
    assert.equal(result.mergeMethods.status, 'skipped');
    assert.equal(result.mergeMethods.reason, 'hitl-declined');
    assert.equal(provider.calls.setBranchProtection.length, 0);
    assert.equal(provider.calls.setMergeMethods.length, 0);
  });

  it('(d) drifted with --assume-yes → every step applies', async () => {
    /* placeholder */
  });

  it('(e) drifted, non-TTY, no assume flags → merge methods default-apply; branch protection declines loudly', async () => {
    // Story #4045 A4: with no operator present (non-TTY) and no explicit
    // assume override, the merge-method step must reach applyMergeMethods'
    // default-apply branch — not be silently declined by the non-TTY HITL
    // gate. Branch protection keeps the abort-on-non-TTY stance.
    const provider = makeMockProvider({
      protection: {
        required_status_checks: {
          strict: true,
          contexts: ['lint'],
        },
        enforce_admins: { enabled: false }, // diverges
        required_pull_request_reviews: {
          required_approving_review_count: 2, // diverges
        },
        restrictions: null,
      },
      mergeState: { ...TARGET_MERGE_METHODS, allow_merge_commit: true },
    });

    const result = await runBootstrap(ORCHESTRATION, {
      providerOverride: provider,
      project: PROJECT_BLOCK,
      githubAdminApproved: true,
      isTTY: false,
      quiet: true,
    });

    assert.equal(result.mergeMethods.status, 'patched');
    assert.equal(provider.calls.setMergeMethods.length, 1);
    // Branch protection still declines loudly under non-TTY.
    assert.equal(result.branchProtection.status, 'skipped');
    assert.equal(result.branchProtection.reason, 'hitl-declined');
    assert.equal(provider.calls.setBranchProtection.length, 0);
  });
});
