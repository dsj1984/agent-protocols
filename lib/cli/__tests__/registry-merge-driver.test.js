/**
 * registry-merge-driver.test.js — the `merge-driver` doctor check
 * (Story #5215).
 *
 * The registration this guards has two halves in two places: `.gitattributes`
 * (tracked, ships with the repo) says which files use the driver, and
 * `merge.mandrel-baseline.driver` (per-clone git config, because git will not
 * run a command chosen by whoever wrote the repository) says what it is. A
 * fresh clone has the first and not the second, and git says nothing — it
 * just falls back to text-merging baselines. The check exists to make that
 * silence audible, and to stay quiet for a repo that never opted in.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  BASELINE_MERGE_ATTRIBUTE,
  BASELINE_MERGE_DRIVER_COMMAND,
  BASELINE_MERGE_DRIVER_CONFIG_KEY,
} from '../../../.agents/scripts/lib/bootstrap/baseline-merge-driver.js';
import { makeTempDir } from '../../../.agents/scripts/lib/test-temp.js';
import { registry, runMergeDriver } from '../registry.js';

/** A project root whose `.gitattributes` holds exactly `content`. */
function projectWith(content) {
  const dir = makeTempDir('mandrel-doctor-merge-');
  if (content !== null) {
    fs.writeFileSync(path.join(dir, '.gitattributes'), content);
  }
  return dir;
}

const unsetConfig = () => ({ status: 1, stdout: '', stderr: '' });
const setConfig = () => ({
  status: 0,
  stdout: `${BASELINE_MERGE_DRIVER_COMMAND}\n`,
  stderr: '',
});

describe('doctor merge-driver — registered in the check order', () => {
  it('runs as a fatal check before pin-current', () => {
    const names = registry.map((c) => c.name);
    assert.ok(names.includes('merge-driver'));
    const entry = registry.find((c) => c.name === 'merge-driver');
    assert.ok(!entry.advisory, 'a silently-degraded merge is not advisory');
  });
});

describe('doctor merge-driver — the repo opted in (AC-7)', () => {
  it('fails with the exact git config command when the driver is unset', () => {
    const cwd = projectWith(`${BASELINE_MERGE_ATTRIBUTE}\n`);
    const result = runMergeDriver({ cwd: () => cwd, runner: unsetConfig });

    assert.equal(result.ok, false);
    assert.equal(
      result.remedy,
      `git config ${BASELINE_MERGE_DRIVER_CONFIG_KEY} "${BASELINE_MERGE_DRIVER_COMMAND}"`,
    );
    assert.match(result.detail, /unset/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('passes once the driver is configured', () => {
    const cwd = projectWith(`${BASELINE_MERGE_ATTRIBUTE}\n`);
    const result = runMergeDriver({ cwd: () => cwd, runner: setConfig });

    assert.equal(result.ok, true);
    assert.equal(result.remedy, undefined);
    assert.match(result.detail, /merge-baseline\.js/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('treats an empty config value as unset', () => {
    const cwd = projectWith(`${BASELINE_MERGE_ATTRIBUTE}\n`);
    const result = runMergeDriver({
      cwd: () => cwd,
      runner: () => ({ status: 0, stdout: '\n', stderr: '' }),
    });
    assert.equal(result.ok, false);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe('doctor merge-driver — the repo never opted in', () => {
  for (const [label, content] of [
    ['no .gitattributes at all', null],
    ['a .gitattributes with unrelated rules', '* text=auto eol=lf\n'],
    ['a commented-out registration', `# ${BASELINE_MERGE_ATTRIBUTE}\n`],
  ]) {
    it(`passes as skipped with ${label}`, () => {
      const cwd = projectWith(content);
      const result = runMergeDriver({
        cwd: () => cwd,
        runner: () => {
          throw new Error('git must not be consulted when the repo opted out');
        },
      });
      assert.equal(result.ok, true);
      assert.match(result.detail, /skipped/);
      fs.rmSync(cwd, { recursive: true, force: true });
    });
  }
});
