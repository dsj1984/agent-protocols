import assert from 'node:assert/strict';
import test from 'node:test';

import { runAuditOrchestrator } from '../.agents/scripts/audit-orchestrator.js';

test('audit-orchestrator imports canonical audit modules', () => {
  assert.equal(typeof runAuditOrchestrator, 'function');
});
