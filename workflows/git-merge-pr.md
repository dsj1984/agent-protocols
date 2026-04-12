---
description: >-
  Analyze, validate, resolve conflicts, and merge a given pull request by
  number.
---

# /git-merge-pr [#PR_LIST]

This workflow performs a full end-to-end merge of one or more pull requests: it
analyzes each PR diff, validates linting and tests, resolves any merge
conflicts, and completes the merge into the target base branch.

> **When to run**: Any time one or more PRs are ready for merge review and you
> want an automated merge with conflict resolution and quality gates enforced.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

---

## Step 0 — Resolve Context

1. Resolve one or more `[PR_NUMBER]` values from the slash-command argument
   (e.g. `/git-merge-pr 42 43 45` → `PR_LIST=[42, 43, 45]`).
2. **Sequential Loop**: Steps 1 through 8 must be performed **sequentially** for
   each PR in the `PR_LIST`. Complete the full merge and cleanup for one PR
   before starting the next.
3. For the current `[PR_NUMBER]`, fetch metadata from GitHub:

   ```powershell
   gh pr view [PR_NUMBER] --json number,title,headRefName,baseRefName,state,mergeable,mergeStateStatus
   ```

4. From the output, resolve:
   - `[PR_TITLE]` — the PR title.
   - `[HEAD_BRANCH]` — the source branch (`headRefName`).
   - `[BASE_BRANCH]` — the merge target (`baseRefName`).
   - `[PR_STATE]` — must be `OPEN`. If `CLOSED` or `MERGED`, **SKIP** this PR
     and proceed to the next one in the list.
   - `[MERGEABLE]` — initial GitHub mergeability signal (`MERGEABLE`,
     `CONFLICTING`, or `UNKNOWN`).

---

## Step 1 — PR Analysis

Fetch the full diff and review the scope of changes:

```powershell
gh pr diff [PR_NUMBER]
```

Summarize the following to the operator before proceeding:

- **Files changed** (count and list).
- **Lines added / removed**.
- **Areas of concern** — any files that touch shared utilities, schemas,
  migrations, or critical infrastructure.
- **Initial mergeability status** from Step 0.

> This is a read-only analysis step. No files are modified yet.

---

## Step 2 — Checkout & Sync

Check out the head branch and rebase it against the latest base to surface
conflicts early:

```powershell
git fetch origin
git checkout [HEAD_BRANCH]
git pull origin [HEAD_BRANCH]
```

Attempt a rebase onto the latest base branch:

```powershell
git rebase origin/[BASE_BRANCH]
```

- If the rebase **succeeds**: proceed to Step 3.
- If the rebase **has conflicts**: proceed to Step 2.5 — Conflict Resolution.

### Step 2.5 — Conflict Resolution

1. Identify conflicting files:

   ```powershell
   git diff --name-only --diff-filter=U
   ```

2. For each conflicting file:
   - Open the file and read both the `HEAD` (incoming from base) and the
     `incoming` (from `[HEAD_BRANCH]`) change blocks.
   - Resolve by applying **both** changes where logically compatible, or by
     choosing the correct side based on the PR's stated intent.
   - **Never silently drop code**. If the resolution is ambiguous, alert the
     operator with a description of the conflict and the two sides before
     choosing.

3. After resolving all files, stage and continue the rebase:

   ```powershell
   git add .
   git rebase --continue
   ```

4. Repeat for any subsequent conflict stanzas until the rebase completes
   cleanly.

5. Force-push the rebased branch:

   ```powershell
   git push --force-with-lease origin [HEAD_BRANCH]
   ```

---

## Step 3 — Lint Gate

Run the project's full linting and formatting suites on the head branch:

// turbo

```powershell
npm run lint
npm run format:check
```

> Both commands must pass. `npm run lint` catches code quality issues;
> `npm run format:check` catches Biome formatting violations that CI also
> enforces. Running only one is insufficient.

- If both **pass**: proceed to Step 4.
- If lint or format **fails**:
  1. Read each error carefully.
  2. For **format** errors, run `npx biome format --write .` to auto-fix, then
     re-run `npm run format:check` to confirm.
  3. For **lint** errors, apply the minimal manual fix required.
  4. Commit the fixes:

     ```powershell
     git add .
     git commit --no-verify -m "fix(lint): resolve lint/format errors on [HEAD_BRANCH] for PR #[PR_NUMBER]"
     git push origin [HEAD_BRANCH]
     ```

  5. Re-run both `npm run lint` and `npm run format:check` to confirm clean
     output before continuing.

---

## Step 4 — Test Gate

Run the full test suite:

// turbo

```powershell
npm test
```

- If tests **pass**: proceed to Step 5.
- If tests **fail**:
  1. Read the failure output and identify the root cause.
  2. Classify the failure:
     - **Pre-existing failures** (unrelated to this PR's diff): alert the
       operator and ask whether to proceed or block.
     - **Regression introduced by this PR**: apply the fix, commit, re-push, and
       re-run the test suite before proceeding.
  3. Commit any test fixes:

     ```powershell
     git add .
     git commit --no-verify -m "test: fix failing tests on [HEAD_BRANCH] for PR #[PR_NUMBER]"
     git push origin [HEAD_BRANCH]
     ```

  4. Re-run `npm test` to confirm zero failures before continuing.

  > If the failure cannot be resolved after exhausting reasonable remediation
  > attempts, **STOP** and escalate to the operator with a detailed summary.

---

## Step 5 — Final Mergeability Check

Re-query GitHub to confirm the PR is now clean and ready to merge:

```powershell
gh pr view [PR_NUMBER] --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
```

Verify:

- `mergeable` is `MERGEABLE`.
- `mergeStateStatus` is `CLEAN` or `HAS_HOOKS`.
- Required CI checks (if any) are passing (`statusCheckRollup` → all `SUCCESS`
  or `NEUTRAL`).

If any blocking condition remains, resolve it before proceeding to the merge
step.

---

## Step 6 — Merge

Merge the PR using a squash commit to keep the base branch history clean:

```powershell
gh pr merge [PR_NUMBER] --squash --subject "[PR_TITLE] (#[PR_NUMBER])" --delete-branch
```

> **Merge strategy guidance** (override with operator instruction):
>
> - `--squash` — default; produces a single, clean commit on `[BASE_BRANCH]`.
> - `--merge` — preserves the full commit history from `[HEAD_BRANCH]` (use for
>   Epic branches with meaningful commit granularity).
> - `--rebase` — linear history; ideal for small, atomic PRs.

After the merge command returns, perform a conflict marker scan to confirm no
stray markers entered the base branch:

```powershell
git checkout [BASE_BRANCH]
git pull origin [BASE_BRANCH]
git grep -n "<<<<<<< " -- . ":(exclude).git"
```

If any markers are found: **STOP**, alert the operator immediately, and do not
proceed until they are resolved.

---

## Step 7 — Post-Merge Verification & Cleanup

Confirm the merge landed correctly on the base branch:

```powershell
git log origin/[BASE_BRANCH] -5 --oneline
```

Verify that the top commit corresponds to the merged PR.

Explicitly delete the remote head branch. This is **mandatory** and must always
succeed — even if the Husky pre-push hook blocks `git push origin --delete`. Use
the **two-stage** approach below:

**Stage 1 — git push (fast path):**

```powershell
# Attempt standard deletion first (fast, uses existing auth)
git push origin --delete [HEAD_BRANCH] 2>$null
$gitDeleteOk = $LASTEXITCODE -eq 0
```

**Stage 2 — REST API fallback (always run if Stage 1 failed):**

If Stage 1 fails (exit code ≠ 0, e.g., due to Husky hook blocking the push),
fall back to the GitHub REST API using the token from the git credential store:

```powershell
if (-not $gitDeleteOk) {
  # Retrieve token from git's native credential manager
  $creds = "protocol=https`nhost=github.com`n" | git credential fill 2>$null
  $token = ($creds | Select-String 'password=(.+)').Matches[0].Groups[1].Value

  if ($token) {
    $url = "https://api.github.com/repos/[OWNER]/[REPO]/git/refs/heads/[HEAD_BRANCH]"
    $headers = @{ Authorization = "token $token"; Accept = "application/vnd.github.v3+json" }
    try {
      Invoke-RestMethod -Method DELETE -Uri $url -Headers $headers -ErrorAction Stop
      Write-Host "Remote branch deleted via REST API: [HEAD_BRANCH]"
    } catch {
      $status = $_.Exception.Response.StatusCode.value__
      if ($status -eq 422 -or $status -eq 404) {
        Write-Host "Branch already gone (HTTP $status) — skipping."
      } else {
        Write-Warning "Failed to delete remote branch via API (HTTP $status): [HEAD_BRANCH]"
      }
    }
  } else {
    Write-Warning "No GitHub token found in credential store — remote branch may not be deleted."
  }
}
```

Prune stale remote-tracking refs and delete the local branch:

```powershell
git fetch --prune
git branch -D [HEAD_BRANCH] 2>$null
```

> **Note:** `git branch -D` is safe to ignore if the local branch does not
> exist. `git fetch --prune` must always run to keep the local ref list clean.

Explicitly close the GitHub PR object. Because this workflow squash-merges
directly into the base branch (bypassing GitHub's native merge flow), GitHub
**will not** auto-close the PR — it must be closed explicitly:

```javascript
// Use the update_pull_request MCP tool:
mcp_github -
  mcp -
  server_update_pull_request({
    owner,
    repo,
    pullNumber: PR_NUMBER,
    state: 'closed',
  });
```

> **Note:** This is a hard requirement — leaving the PR open after merging
> pollutes the repository's open PR list and causes confusion for reviewers.

Optionally, run the test suite one final time on the base branch to confirm no
regressions were introduced by the merge:

```powershell
npm test
```

---

## Step 8 — Summary Report

Post a structured summary comment to the PR (now closed) for traceability:

```powershell
gh pr comment [PR_NUMBER] --body "✅ **Merged by agent** via \`/git-merge-pr\`

- **Branch**: \`[HEAD_BRANCH]\` → \`[BASE_BRANCH]\`
- **Conflicts resolved**: [YES/NO — list files if YES]
- **Lint fixes applied**: [YES/NO]
- **Test fixes applied**: [YES/NO]
- **Merge strategy**: squash"
```

---

## Constraint

- **Never** merge a PR that has unresolved lint errors or failing tests. Running
  a passing quality gate is mandatory before the merge commit.
- **Never** silently drop code when resolving merge conflicts. When in doubt,
  ask the operator.
- **Never** bypass required GitHub branch protection checks (required reviewers,
  required status checks). If these are blocking, surface them to the operator
  rather than attempting to force-merge.
- **Always** explicitly delete the remote head branch in Step 7 with
  `git push origin --delete [HEAD_BRANCH]`. Do **not** rely solely on
  `gh pr merge --delete-branch` — that flag is silently skipped when a PR
  auto-closes without a normal merge commit (e.g., duplicate rebase scenarios).
- **Always** treat a "remote ref not found" error from the delete command as a
  non-fatal, idempotent success — the branch is already gone.
- **Always** use `--force-with-lease` (never bare `--force`) when pushing
  rebased branches to avoid overwriting concurrent pushes.
- **Always** explicitly close the GitHub PR via
  `update_pull_request(state: closed)` in Step 7 after branch cleanup. Because
  this workflow pushes directly to the base branch, GitHub will **never**
  auto-close the PR — it must be closed manually every time.
- **Always** post a Step 8 summary comment for auditability, even if no fixes
  were required.
