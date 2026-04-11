---
description: >-
  Triage and remediate CI failures using governance-tiered auto-healing.
  Dispatches to the configured adapter (Jules API or GitHub Issue) based
  on the risk tier of the failed stages.
---

# /ci-auto-heal

This workflow manually triggers the auto-heal pipeline for a CI run that the
automated job did not catch, or for local diagnostics of a failure scope and
risk tier.

> **When to run**: After a CI failure on `main` when auto-heal did not trigger
> automatically, or when you want to understand the risk tier and prompt before
> dispatching.

## Step 0 — Gather Failure Context

1. Identify the failed CI stage names from the workflow run summary.
2. Download the error log artifacts produced by each failed stage to a local
   directory. If no artifacts were uploaded, the script will log an advisory but
   continue with a prompt-less context block.

```powershell
# Example: download artifacts using the GitHub CLI
gh run download <run-id> --dir ./auto-heal-errors
```

1. Note the commit SHA and PR number (or `0` if no PR):

```powershell
$sha = git rev-parse HEAD
$branch = git rev-parse --abbrev-ref HEAD
```

## Step 1 — Dispatch Auto-Heal

Run the script with the stage names and results from the failed pipeline.
Replace `<result>` with the actual outcome (`success`, `failure`, `skipped`,
or `cancelled`).

```powershell
node .agents/scripts/auto-heal.js `
  --stage "lint=<result>" `
  --stage "typecheck=<result>" `
  --stage "unit=<result>" `
  --stage "e2e=<result>" `
  --errors-dir ./auto-heal-errors `
  --sha "<commit-sha>" `
  --pr "<pr-number>" `
  --branch "<branch-name>"
```

To preview the assembled prompt and risk analysis **without dispatching**:

```powershell
node .agents/scripts/auto-heal.js `
  --stage "lint=failure" `
  --stage "typecheck=success" `
  --errors-dir ./auto-heal-errors `
  --sha "<commit-sha>" `
  --dry-run
```

## Step 2 — Monitor & Verify

**Jules adapter** — The script logs the session ID on success. Monitor the
session in the Jules UI at `https://jules.google.com/`. Once the session
completes, review the proposed changes in the resulting pull request.

**GitHub Issue adapter** — The script logs the issue URL on success. Assign
a human reviewer or Copilot Workspace session to the issue. Track completion
via the issue status.

After the fix is applied, run the full local validation suite to confirm the
regression is resolved:

```powershell
npm run lint
npm test
```

## Constraints

- Auto-heal is **best-effort**. It MUST NOT fail CI or block any downstream job.
  The `auto-heal.js` script always exits with code `0`.
- Only stages that are explicitly configured in `autoHeal.stages` within
  `.agentrc.json` produce prompts with modification constraints. Unknown stages
  default to `red` tier for safety.
- The **highest-risk failed stage** determines the overall governance tier:
  - 🟢 **green** — `autoApprove: true` — no plan approval needed.
  - 🟡 **yellow** — `autoApprove: false` — plan approval required.
  - 🔴 **red** — `autoApprove: false` — plan approval required; full human review
    recommended before merge.
- All auto-heal changes should be reviewed in the resulting PR/session before
  merging to a protected branch.
