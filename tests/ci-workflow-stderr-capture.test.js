import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CI_WORKFLOW = join(__dirname, '..', '.github', 'workflows', 'ci.yml');

function getTestCoverageStep(source) {
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((l) =>
    /name:\s*Run Tests with Coverage/.test(l),
  );
  assert.notEqual(
    startIdx,
    -1,
    'Run Tests with Coverage step not found in .github/workflows/ci.yml',
  );
  const rest = lines.slice(startIdx);
  const nextStepIdx = rest
    .slice(1)
    .findIndex((l) => /^\s*- (name|uses):/.test(l));
  const endIdx = nextStepIdx === -1 ? rest.length : nextStepIdx + 1;
  return rest.slice(0, endIdx).join('\n');
}

test('CI workflow Run Tests with Coverage step preserves stderr-capture regression guards', () => {
  const source = readFileSync(CI_WORKFLOW, 'utf8');
  const step = getTestCoverageStep(source);

  assert.match(
    step,
    /2>&1|\|&/,
    'Coverage step must redirect stderr into the captured artifact (2>&1 or |&). Regression guard for Epic #441 Story 4.1 — stdout-only redirect hid test failures.',
  );

  assert.match(
    step,
    /set\s+-o\s+pipefail|set\s+-eo?\s+pipefail/,
    'Coverage step must set pipefail so a failing `npm run test:coverage` propagates through `tee`. Regression guard for Epic #441 Story 4.1.',
  );

  assert.match(
    step,
    /npm run test:coverage/,
    'Coverage step must still invoke `npm run test:coverage`.',
  );
});

// ---------------------------------------------------------------------------
// Story #4922 — the coverage instrument's CI wiring.
// ---------------------------------------------------------------------------

test('the coverage step runs the pretest preflight explicitly', () => {
  const source = readFileSync(CI_WORKFLOW, 'utf8');
  const step = getTestCoverageStep(source);
  assert.match(
    step,
    /npm run pretest:coverage/,
    "The coverage step must invoke the preflight by name. npm's `pre<script>` " +
      'hook cannot be relied on here: .npmrc sets ignore-scripts=true, which ' +
      'suppresses every pre*/post* lifecycle script for `npm run` as well as ' +
      'for installs, so `pretest:coverage` never fires as a hook.',
  );
  assert.ok(
    step.indexOf('npm run pretest:coverage') <
      step.indexOf('npm run test:coverage 2>&1'),
    'the preflight must run BEFORE the measured suite',
  );
});

test('the worktree-manager real-git contract executes in a CI job', () => {
  const source = readFileSync(CI_WORKFLOW, 'utf8');
  assert.match(
    source,
    /tests\/lib\/worktree-manager\.integration\.test\.js/,
    'tests/lib/worktree-manager.integration.test.js must be invoked by a CI ' +
      'job. It is integration-tier (so `test:quick` on the Windows leg skips ' +
      'it) and its drive-letter-case guard is win32-gated, so without an ' +
      'explicit Windows invocation that assertion runs in no job at all.',
  );
});

test('the Windows leg is where the win32-gated guard runs', () => {
  const source = readFileSync(CI_WORKFLOW, 'utf8');
  const windowsJob = source.slice(source.indexOf('  windows-smoke:'));
  assert.ok(
    windowsJob.length > 0,
    'windows-smoke job not found in .github/workflows/ci.yml',
  );
  assert.match(
    windowsJob,
    /tests\/lib\/worktree-manager\.integration\.test\.js/,
    'the worktree-manager contract must run on the Windows leg — its ' +
      'drive-letter-case regression only reproduces there',
  );
});
