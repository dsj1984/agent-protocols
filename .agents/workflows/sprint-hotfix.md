---
description: >-
  Rapid remediation of regressions on a Task feature branch after a failed
  Epic integration candidate check.
---

# Sprint Hotfix

This workflow fixes regressions or build failures identified during
`/sprint-integration`. It operates exclusively on the original Task feature
branch to keep the Epic base branch clean.

> **When to run**: After `/sprint-integration` exits with code `1` (Build
> Broken) for a specific Task.

## Step 0 — Resolve Context

1. Identify `[TASK_ID]` — the GitHub Issue number of the failed Task.
2. Resolve `[EPIC_ID]` from the Task body `## Metadata` → `Epic: #<N>`.
3. Resolve `[TASK_BRANCH]` — `task/epic-<epicId>/<taskId>`.
4. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
5. Resolve `[MAX_RETRY]` from `frictionThresholds.maxIntegrationRetries` in
   `.agentrc.json` (default: 2).
6. Track your current retry count for this Task.

## Step 1 — Apply Blocked Status

Before starting remediation, apply `status::blocked` to the Task ticket and
post a friction comment to surface the failure to the operator:

```javascript
// transitionTicketState([TASK_ID], 'status::blocked')
// postStructuredComment([TASK_ID], 'friction',
//   'Integration failed. Hotfix in progress. Retry [N] of [MAX_RETRY].')
```

## Step 2 — Environment Reset

Check out the Task feature branch and rebase against the Epic base:

```powershell
git checkout task/epic-[EPIC_ID]/[TASK_ID]
git pull --rebase origin epic/[EPIC_ID]
```

If rebase has conflicts, resolve them, stage, and continue:

```powershell
git rebase --continue
```

## Step 3 — Diagnostic Audit

1. Read the friction log for the failure details:
   - Check any `agent-friction-log.json` output from `diagnose-friction.js`.
   - Review the `sprint-integrate.js` output printed during the failed run.
2. Reproduce the failure locally:

   ```powershell
   npm run lint
   npm test
   ```

## Step 4 — Remediation

Implement the necessary fixes. Keep changes tightly scoped to the root cause.
Do **not** add unrelated features or refactors at this step.

Run isolated validation for the specific failure area after each fix.

## Step 5 — Local Verification

Execute the full validation suite to confirm the fix is clean:

```powershell
npm run lint
npm test
```

Both must pass with zero errors before proceeding.

## Step 6 — Commit & Re-Push

```powershell
git add .
git commit --no-verify -m "fix([scope]): hotfix integration failure for #[TASK_ID] ([brief description])"
git push --force-with-lease origin task/epic-[EPIC_ID]/[TASK_ID]
```

## Step 7 — Clear Blocked Status

Remove the `status::blocked` label and post a recovery comment:

```javascript
// transitionTicketState([TASK_ID], 'agent::review')
// postStructuredComment([TASK_ID], 'progress',
//   'Hotfix applied. Branch re-pushed. Re-running integration.')
```

## Step 8 — Re-Integration

- **If retry count ≤ `[MAX_RETRY]`**: Re-run `/sprint-integration` to attempt
  merging into the Epic base branch again.
- **If retry count > `[MAX_RETRY]`**: **STOP IMMEDIATELY.** You have hit the
  anti-thrashing threshold. Post a final friction comment and escalate to the
  operator with a summary of all remediation attempts and the outstanding
  failure.

  ```javascript
  // postStructuredComment([TASK_ID], 'friction',
  //   'ESCALATION: hotfix failed after [MAX_RETRY] attempts. Operator intervention required.')
  ```

## Constraint

Do **not** attempt to fix regressions directly on `[EPIC_BRANCH]`. Always
maintain isolation on the Task feature branch to protect the blast-radius of
the shared Epic integration branch. Do **not** skip the Blocked Status steps —
the operator must always have visibility into failures via the ticket graph.
