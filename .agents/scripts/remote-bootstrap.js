#!/usr/bin/env node
/* node:coverage ignore file */
/**
 * Remote Bootstrap — boots the Claude remote-agent environment for
 * `/sprint-execute-epic`.
 *
 * Invoked by `.github/workflows/epic-dispatch.yml` (via the Claude
 * remote-agent runner). Steps:
 *   1. git clone the target repo into a working directory.
 *   2. Materialize `.env` and `.mcp.json` from the `ENV_FILE` and
 *      `MCP_JSON` environment variables, emitting `::add-mask::` for
 *      each non-empty line so any accidental echo is redacted in logs.
 *   3. Run `npm ci` (lockfile-strict) with `--ignore-scripts`.
 *   4. Exec `claude /sprint-execute-epic <EPIC_ID>` so the orchestrator
 *      engine takes over the rest of the run.
 *
 * Required env:
 *   EPIC_ID           — Epic issue number to orchestrate.
 *   REPO_URL          — HTTPS clone URL (e.g. https://github.com/owner/repo.git).
 *                       Defaults to `https://github.com/${GITHUB_REPOSITORY}.git`.
 *   ENV_FILE          — contents for `.env` (multi-line string).
 *   MCP_JSON          — contents for `.mcp.json` (JSON string).
 *   GITHUB_TOKEN      — token used for the clone (injected as x-access-token).
 *
 * Optional env:
 *   WORKSPACE_DIR     — target directory for the clone (default: `./workspace`).
 *   REPO_REF          — branch/ref to check out (default: `main`).
 *   CLAUDE_BIN        — path to the `claude` CLI (default: `claude`).
 *   SKIP_LAUNCH       — when truthy, skip the final `claude` exec. Useful for
 *                       integration tests of the bootstrap itself.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function log(msg) {
  console.log(`[remote-bootstrap] ${msg}`);
}

function fatal(msg) {
  console.error(`[remote-bootstrap] ERROR: ${msg}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    fatal(`Missing required env var: ${name}`);
  }
  return value;
}

function maskSecret(value) {
  // Emit ::add-mask:: per non-empty line so GitHub Actions redacts any
  // accidental echo. Safe to call even outside Actions — consumers just
  // see the directive in stdout.
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      console.log(`::add-mask::${trimmed}`);
    }
  }
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    fatal(`${cmd} exited with status ${result.status}`);
  }
}

function writeSecretFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: 0o600 });
}

async function main() {
  const epicId = requireEnv('EPIC_ID');
  const envFile = requireEnv('ENV_FILE');
  const mcpJson = requireEnv('MCP_JSON');
  const githubToken = requireEnv('GITHUB_TOKEN');

  const repoSlug = process.env.GITHUB_REPOSITORY;
  const repoUrl =
    process.env.REPO_URL ||
    (repoSlug ? `https://github.com/${repoSlug}.git` : null);
  if (!repoUrl) {
    fatal('REPO_URL or GITHUB_REPOSITORY must be set.');
  }

  const workspace = resolve(process.env.WORKSPACE_DIR || 'workspace');
  const ref = process.env.REPO_REF || 'main';

  // 1. Mask secrets before any file I/O so stray echoes get redacted.
  maskSecret(envFile);
  maskSecret(mcpJson);
  maskSecret(githubToken);

  // 2. Clone. Inject token via URL so it is never placed on argv of a
  // subprocess in clear text form beyond this one call.
  const cloneUrl = repoUrl.replace(
    /^https:\/\//,
    `https://x-access-token:${githubToken}@`,
  );
  log(`Cloning ${repoUrl} @ ${ref} → ${workspace}`);
  run('git', [
    'clone',
    '--depth=1',
    '--branch',
    ref,
    cloneUrl,
    workspace,
  ]);

  // 3. Materialize secret-backed workspace files with 0600 perms.
  writeSecretFile(resolve(workspace, '.env'), envFile);
  writeSecretFile(resolve(workspace, '.mcp.json'), mcpJson);
  log('Provisioned .env and .mcp.json (mode 0600).');

  // 4. Install dependencies with a strict lockfile and no lifecycle
  //    scripts (supply-chain containment).
  run('npm', ['ci', '--ignore-scripts'], { cwd: workspace });

  // 5. Hand off to /sprint-execute-epic.
  if (process.env.SKIP_LAUNCH) {
    log('SKIP_LAUNCH set — bootstrap complete, not launching claude.');
    return;
  }
  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  log(`Launching ${claudeBin} /sprint-execute-epic ${epicId}`);
  run(claudeBin, ['/sprint-execute-epic', String(epicId)], {
    cwd: workspace,
  });
}

main().catch((err) => {
  fatal(err?.stack || String(err));
});
