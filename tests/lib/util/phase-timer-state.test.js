import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createPhaseTimer } from '../../../.agents/scripts/lib/util/phase-timer.js';
import {
  clearPhaseTimerState,
  loadPhaseTimerState,
  savePhaseTimerState,
} from '../../../.agents/scripts/lib/util/phase-timer-state.js';

describe('phase-timer-state', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-timer-state-'));
    fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('round-trips a live snapshot from save → load → restore', () => {
    const timer = createPhaseTimer(42, { logger: () => {} });
    timer.mark('worktree-create');
    timer.mark('implement');
    savePhaseTimerState(timer, { mainCwd: tmpRoot, storyId: 42 });

    const snap = loadPhaseTimerState({ mainCwd: tmpRoot, storyId: 42 });
    assert.ok(snap, 'snapshot must load');
    assert.equal(snap.storyId, 42);
    assert.equal(snap.current.name, 'implement');

    const restored = createPhaseTimer(42, { restore: snap, logger: () => {} });
    restored.mark('close');
    const summary = restored.finish();
    const names = summary.phases.map((p) => p.name);
    assert.deepEqual(names, ['worktree-create', 'implement', 'close']);
  });

  it('loadPhaseTimerState returns null when the file is absent', () => {
    assert.equal(loadPhaseTimerState({ mainCwd: tmpRoot, storyId: 999 }), null);
  });

  it('loadPhaseTimerState returns null when the file is unparseable', () => {
    const p = path.join(tmpRoot, '.git', 'story-7-phase-timer.json');
    fs.writeFileSync(p, '{ not json', 'utf8');
    assert.equal(loadPhaseTimerState({ mainCwd: tmpRoot, storyId: 7 }), null);
  });

  it('clearPhaseTimerState removes the file idempotently', () => {
    const timer = createPhaseTimer(5, { logger: () => {} });
    timer.mark('lint');
    savePhaseTimerState(timer, { mainCwd: tmpRoot, storyId: 5 });
    const p = path.join(tmpRoot, '.git', 'story-5-phase-timer.json');
    assert.ok(fs.existsSync(p));
    clearPhaseTimerState({ mainCwd: tmpRoot, storyId: 5 });
    assert.ok(!fs.existsSync(p));
    // Second call is a no-op.
    assert.doesNotThrow(() =>
      clearPhaseTimerState({ mainCwd: tmpRoot, storyId: 5 }),
    );
  });

  it('save is atomic — no partial .tmp file survives a successful write', () => {
    const timer = createPhaseTimer(3, { logger: () => {} });
    timer.mark('install');
    savePhaseTimerState(timer, { mainCwd: tmpRoot, storyId: 3 });
    const dir = path.join(tmpRoot, '.git');
    const entries = fs.readdirSync(dir);
    assert.ok(entries.includes('story-3-phase-timer.json'));
    assert.ok(
      !entries.some((e) => e.endsWith('.tmp')),
      `no leftover .tmp files: ${entries.join(', ')}`,
    );
  });
});
