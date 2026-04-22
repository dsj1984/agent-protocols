import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CI_WORKFLOW = join(__dirname, '..', '.github', 'workflows', 'ci.yml');

function getTestCoverageStep(source) {
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /name:\s*Run Tests with Coverage/.test(l));
  assert.notEqual(
    startIdx,
    -1,
    'Run Tests with Coverage step not found in .github/workflows/ci.yml',
  );
  const rest = lines.slice(startIdx);
  const nextStepIdx = rest.slice(1).findIndex((l) => /^\s*- (name|uses):/.test(l));
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
