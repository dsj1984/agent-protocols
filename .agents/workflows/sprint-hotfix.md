---
description: >-
  Rapid remediation of regressions on a Task feature branch after a failed Epic
  integration candidate check.
---

# Sprint Hotfix

This workflow fixes regressions or build failures identified during
story execution or review. It operates exclusively on the original Story
branch to keep the Epic base branch clean.

> **When to run**: When a regression or build failure is found for a
> specific Story.

## Step 0 — Resolve Context

1. Identify `[STORY_ID]` — the GitHub Issue number of the failed Story.
2. Resolve `[EPIC_ID]` from the Story body `## Metadata` → `Epic: #<N>`.
3. Resolve `[STORY_BRANCH]` — `story/epic-<epicId>/[STORY_ID]`.
4. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
5. Resolve `[MAX_RETRY]` from `frictionThresholds.maxIntegrationRetries` in
   `.agentrc.json` (default: 2).
6. Track your current retry count for this Story.

## Step 1 — Apply Blocked Status

Before starting remediation, apply `status::blocked` to the Story ticket and post
a friction comment to surface the failure to the operator:

```javascript
// transitionTicketState([STORY_ID], 'status::blocked')
// postStructuredComment([STORY_ID], 'friction',
//   'Validation failed. Hotfix in progress. Retry [N] of [MAX_RETRY].')
```

## Step 2 — Environment Reset

Check out the Story branch and rebase against the Epic base:

```powershell
git checkout story/epic-[EPIC_ID]/[STORY_ID]
git pull --rebase origin epic/[EPIC_ID]
```

If rebase has conflicts, resolve them, stage, and continue:

```powershell
git rebase --continue
```

## Step 3 — Diagnostic Audit

1. Read the friction log for the failure details:
   - Check any `agent-friction-log.json` output from `diagnose-friction.js`.
   - Review CI/CD or local test output printed during the failure.
2. Reproduce the failure locally:

   ```powershell
   npm run lint
   npm test
   ```

## Step 4 — Remediation

Implement the necessary fixes. Keep changes tightly scoped to the root cause. Do
**not** add unrelated features or refactors at this step.

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
git commit --no-verify -m "fix([scope]): hotfix validation failure for #[STORY_ID] ([brief description])"
git push --force-with-lease origin story/epic-[EPIC_ID]/[STORY_ID]
```

## Step 7 — Clear Blocked Status

Remove the `status::blocked` label and post a recovery comment:

```javascript
// transitionTicketState([STORY_ID], 'agent::executing')
// postStructuredComment([STORY_ID], 'progress',
//   'Hotfix applied. Branch re-pushed. Ready for re-evaluation.')
```

## Step 8 — Re-evaluation

- **If retry count ≤ `[MAX_RETRY]`**: Re-run validation to verify
  the fix is correct.
- **If retry count > `[MAX_RETRY]`**: **STOP IMMEDIATELY.** You have hit the
  anti-thrashing threshold. Post a final friction comment and escalate to the
  operator with a summary of all remediation attempts and the outstanding
  failure.

  ```javascript
  // postStructuredComment([STORY_ID], 'friction',
  //   'ESCALATION: hotfix failed after [MAX_RETRY] attempts. Operator intervention required.')
  ```

## Constraint

Do **not** attempt to fix regressions directly on `[EPIC_BRANCH]`. Always
maintain isolation on the Story branch to protect the blast-radius of the
shared Epic integration branch. Do **not** skip the Blocked Status steps — the
operator must always have visibility into failures via the ticket graph.
