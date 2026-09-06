// tests/audit-suite/audit-fan-out-retirement.test.js
//
// The /audit-fan-out workflow is retired. This guard asserts both halves of
// that retirement: the source workflow is gone, and the generated command is
// reaped from the `.claude/commands/` projection.
//
// The command half is asserted against a *fresh* projection into a temp tree
// seeded with the stale command, not against the repo's own
// `.claude/commands/`. That mirror is generated and gitignored, materialized
// by the `prepare` script, so it is empty in any freshly materialized worktree
// — where a plain "the file is not there" assertion passed vacuously, proving
// nothing. See `tests/helpers/projected-commands.js`.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { projectCommands } from '../helpers/projected-commands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const RETIRED_WORKFLOW = '.agents/workflows/audit-fan-out.md';
const RETIRED_COMMAND = 'audit-fan-out.md';

const RETIRED_HINT =
  'The /audit-fan-out workflow is retired; if you need parallel audit ' +
  'orchestration, propose a replacement surface rather than restoring this file.';

test(`audit-fan-out retirement: ${RETIRED_WORKFLOW} must not exist`, () => {
  assert.equal(
    existsSync(path.join(REPO_ROOT, RETIRED_WORKFLOW)),
    false,
    `${RETIRED_WORKFLOW} was reintroduced. ${RETIRED_HINT}`,
  );
});

test('audit-fan-out retirement: .claude/commands/audit-fan-out.md is reaped as an orphan', () => {
  const projection = projectCommands({ seedOrphans: [RETIRED_COMMAND] });
  assert.equal(
    projection.has(RETIRED_COMMAND),
    false,
    `.claude/commands/${RETIRED_COMMAND} was reintroduced. ${RETIRED_HINT}`,
  );
});
