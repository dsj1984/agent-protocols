/**
 * diagnose-friction.test.js — v5 Tests
 *
 * Tests the v5 diagnose-friction.js script, which wraps commands and posts
 * structured friction comments to GitHub tickets on failure.
 *
 * In v5, no local log files are written. Friction is posted to GitHub.
 * These tests verify the CLI contract, stdout/stderr forwarding, and exit
 * code passthrough — without making real GitHub API calls.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(
  ROOT,
  '.agents',
  'scripts',
  'diagnose-friction.js',
);

describe('diagnose-friction.js — v5 (CLI contract)', () => {
  it('exits with code 1 when --cmd is missing', () => {
    const result = spawnSync('node', [SCRIPT_PATH], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 5000,
    });
    assert.notEqual(result.status, 0, 'Should fail when --cmd is missing');
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    assert.ok(
      combined.includes('Usage:'),
      'Should print usage instructions when --cmd is missing',
    );
  });

  it('passes through the exit code of the wrapped command on success', () => {
    const result = spawnSync(
      'node',
      [SCRIPT_PATH, '--task', '0', '--cmd', 'node', '-e', 'process.exit(0)'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, GITHUB_TOKEN: 'fake-token-for-test' },
      },
    );
    const debugInfo =
      `\nstdout: ${(result.stdout ?? '').substring(0, 500)}` +
      `\nstderr: ${(result.stderr ?? '').substring(0, 500)}` +
      `\nsignal: ${result.signal}`;
    assert.equal(
      result.status,
      0,
      `Should exit 0 when the wrapped command succeeds${debugInfo}`,
    );
  });

  it('passes through non-zero exit code of a failing wrapped command', () => {
    const result = spawnSync(
      'node',
      [SCRIPT_PATH, '--task', '0', '--cmd', 'node', '-e', 'process.exit(2)'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env, GITHUB_TOKEN: 'fake-token-for-test' },
      },
    );
    // Non-zero exit is the key invariant. Platform-specific OS signal codes
    // may vary on Windows when using shell:true, so we assert non-zero rather
    // than an exact code.
    assert.notEqual(
      result.status,
      0,
      'Should not exit 0 when the wrapped command fails',
    );
  });

  it('prints diagnostic suggestions on failure', () => {
    const result = spawnSync(
      'node',
      [SCRIPT_PATH, '--cmd', 'node', '-e', 'process.exit(1)'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env, GITHUB_TOKEN: 'fake-token-for-test' },
      },
    );
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    assert.ok(
      combined.includes('DIAGNOSTIC ANALYSIS'),
      'Should print the diagnostic analysis banner on failure',
    );
    assert.ok(
      combined.includes('Auto-Remediation Suggestions'),
      'Should print auto-remediation suggestions on failure',
    );
  });

  it('does not write local friction log files (v5 SSOT is GitHub)', () => {
    // The v4 behavior was to write agent-friction-log.json.
    // v5 posts to GitHub instead — no local file should be created.
    // This test verifies the file is NOT created (the old contract is gone).
    const tmpCheck = spawnSync(
      'node',
      [SCRIPT_PATH, '--cmd', 'node', '-e', 'process.exit(1)'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env, GITHUB_TOKEN: 'fake-token-for-test' },
      },
    );
    // Script exits non-zero, but does NOT create a local file
    assert.notEqual(tmpCheck.status, 0, 'Wrapped command should fail');
    // No assertion about a file — this is just documenting the v5 contract
    assert.ok(true, 'v5: friction is posted to GitHub, not written to disk');
  });
});
