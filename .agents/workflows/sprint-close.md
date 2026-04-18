---
description: >-
  Final Epic closure — merge the Epic base branch to main, close the Epic issue
  via GitHub provider, clean up branches, and tag a release.
---

# Sprint Close

This workflow is the **terminal step** of the Epic lifecycle. It promotes the
fully integrated and reviewed `epic/<epicId>` branch into `main`, closes the
Epic GitHub issue, cleans up all sprint branches, and optionally tags a release.

> **When to run**: As soon as all child work is closed. `/sprint-close` now
> **auto-invokes** the mandatory pre-merge gates (`/sprint-code-review` in Step
> 1.4 and `/sprint-retro` in Step 1.5) when they have not already been
> completed, so operators no longer need to run them by hand.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic to close.
2. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
4. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json`.
5. Resolve `[RELEASE_CONFIG]` — the `release` object from `.agentrc.json`:
   - `release.docs` — array of file paths to verify (e.g.,
     `["README.md", "docs/CHANGELOG.md"]`). Defaults to `[]`.
   - `release.versionFile` — path to a plain-text version file (e.g.,
     `.agents/VERSION`). Defaults to `null`.
   - `release.packageJson` — boolean; if `true` the version in the root
     `package.json` is also bumped. Defaults to `true`.
   - `release.autoVersionBump` — boolean; if `true` (default) the agent
     automatically determines whether to bump the **minor** or **patch** segment
     based on the scope of changes in the Epic. If `false`, no automatic version
     bump is performed (the operator must bump manually or specify the segment
     at invocation time).
6. Resolve `[ALL_DOCS]` — the combined array of documentation files to verify:
   - All files listed in `release.docs`.
   - All files listed in `agentSettings.docsContextFiles` (prefixed with the
     path from `agentSettings.docsRoot`).
7. Resolve `[RUN_RETRO]` from `agentSettings.sprintClose.runRetro` in
   `.agentrc.json` (default: `true`). When `false`, Step 1.5 is skipped entirely
   — no retro is required or produced.

## Step 0.5 — Wave Completeness Gate

Before any hierarchy or merge work, verify every Story in the Epic's dispatch
manifest is closed. The manifest is persisted as a `dispatch-manifest`
structured comment on the Epic by `/sprint-plan` (and by every subsequent
dispatcher run), which makes it the authoritative source of truth for which
Stories the sprint actually committed to.

```powershell
node [SCRIPTS_ROOT]/sprint-wave-gate.js --epic [EPIC_ID]
```

If the script exits non-zero: **STOP IMMEDIATELY.** The printed output lists
every Story ID from the manifest that is still open, along with its wave and
title. Close or re-dispatch the outstanding Stories before re-running
`/sprint-close`.

## Step 1 — Completeness Gate (Hierarchy Check)

Before executing any git operations, verify ALL child items under the Epic are
successfully closed:

1. **Tasks**: Must all be `agent::done` and closed.
2. **Stories**: Must all be closed.
3. **Features**: Must all be closed.

If ANY child ticket is not closed: **STOP IMMEDIATELY.** Alert the operator with
the exact open IDs.

## Step 1.4 — Code Review Gate (auto-invoke)

Before any merge-to-main, the Epic must have passed a `/sprint-code-review`.
Historically this step was operator-driven — if the review hadn't been run,
`/sprint-close` would halt and ask the operator to run it separately, which
created friction between "all child work is done" and "Epic is actually merged."
As of v5.8.7, the close workflow **auto-invokes** the review and only stops if
the review itself surfaces a blocker.

1. Invoke `/sprint-code-review [EPIC_ID]` inline (read-only audit mode — no
   remediation).
2. Inspect the resulting findings report:
   - **Any 🔴 Critical Blocker** — STOP. Relay the blockers to the operator and
     do not proceed to Step 1.5. The operator decides whether to fix on the Epic
     branch and re-run `/sprint-close`, or to override explicitly.
   - **Only 🟠/🟡/🟢 findings** — log them to the operator as "non-blocking
     review findings" and continue to Step 1.5. Non-blocking findings are
     surfaced but do not halt the close.
3. If the operator passes `--skip-code-review` at invocation time, skip this
   step entirely and log `"code review skipped by operator override"`.

> **Why this changed:** The old gate assumed `/sprint-code-review` had already
> been run out-of-band and stopped when it couldn't detect evidence. But
> `/sprint-code-review` produces an inline report, not a persisted marker, so
> the gate's "not detected" state collapsed to "never run." Auto- invoking
> removes the ambiguity and makes the close workflow self-complete.

## Step 1.5 — Retrospective Gate (auto-invoke)

**Skip this step entirely when `[RUN_RETRO]` is `false`.** Log
`"retro skipped by config (agentSettings.sprintClose.runRetro=false)"` and
proceed to Step 2.

When `[RUN_RETRO]` is `true` (default), verify a retrospective comment has been
posted on the Epic issue. Retros are stored as comments on the Epic — there is
no local retro file.

Detection strategy:

1. **Preferred**: fetch `provider.getComments(epicId)` (or
   `provider.getTicketComments(epicId)`) and filter for a comment whose
   `type === "retro"` metadata is present.
2. **Fallback**: grep the raw comment bodies for the
   `<!-- retro-complete: ... -->` HTML marker written at the end of the retro
   body.

```powershell
# Fallback grep — matches the retro-complete HTML marker.
gh api "repos/{owner}/{repo}/issues/[EPIC_ID]/comments" \
  --jq '.[] | select(.body | test("retro-complete:"))'
```

If no matching comment is found, **auto-invoke** `/sprint-retro [EPIC_ID]`
inline. The retro skill produces and posts the retrospective comment on the
Epic, then returns. After it completes, re-run the `gh api` check above to
confirm the comment is now present; if it is, proceed to Step 2. If the retro
skill failed to produce a comment for any reason, STOP and relay the failure to
the operator.

> **Why this gate exists:** Without it, retros get silently skipped and the Epic
> closes with no post-mortem record. The gate reads directly from GitHub (the
> retro's source of truth), not a local path.
>
> **Why it now auto-invokes:** The prior "STOP and ask the operator to run
> `/sprint-retro`" step generated friction every time — the operator always
> wanted option (a) (run it, then continue). Auto-invocation collapses the
> round-trip; the gate still exists as a failure detector, it just no longer
> requires a human handoff to pass.

## Step 2 — Documentation Freshness Gate

For each file listed in `[ALL_DOCS]`, verify it has been meaningfully updated
during this Epic's lifecycle. The check is intentionally simple — it confirms
that the file was **modified** (staged or committed) relative to `[BASE_BRANCH]`
so that the operator cannot forget to update user-facing documentation before a
release.

```powershell
# For each doc path in [ALL_DOCS]:
git diff [BASE_BRANCH]..HEAD --name-only -- [DOC_PATH]
```

For every file that shows **no diff** (i.e., no changes compared to
`[BASE_BRANCH]`):

1. **Alert the operator** with the exact file path.
2. Open the file, review the Epic's completed tickets (title + description), and
   add or update the relevant sections to accurately reflect the changes shipped
   in this Epic.
3. Stage the documentation changes:

```powershell
git add [DOC_PATH]
git commit -m "docs: update [DOC_PATH] for Epic #[EPIC_ID]"
```

> **Guidance for consuming projects:** Add every file your release process
> requires to `release.docs` or `agentSettings.docsContextFiles` in
> `.agentrc.json`. Common examples: `README.md`, `docs/CHANGELOG.md`,
> `MIGRATION.md`, `API.md`.

## Step 3 — Version Bump & Tag

If `release.autoVersionBump` is `false`, **skip this entire step** — do not bump
any version, do not create a tag. Proceed directly to Step 4.

If `release.autoVersionBump` is `true` (default) **and** at least one of
`release.versionFile` or `release.packageJson` is configured, increment the
project version **before** the merge to `main`.

1. **Read** the current version string from `[RELEASE_CONFIG].versionFile` (if
   set) or `package.json#version`.
1. **Determine the bump segment** by inspecting the Epic's completed tickets:
   - **minor** — if the Epic introduced new user-facing features, new workflows,
     new CLI commands, new API surfaces, or significant behavioral changes.
   - **patch** — if the Epic contained only bug fixes, documentation updates,
     refactors, dependency bumps, or internal tooling changes with no
     user-facing feature additions.
   - The operator may override this decision at invocation time (e.g., "use
     major for this release").
1. **Calculate** the next version by incrementing the chosen segment
   (`major.minor.patch`).
1. **Write** the new version:

```powershell
# If release.versionFile is set:
# Write the new version string to that file (overwrite contents).

# If release.packageJson is true (default):
npm version [BUMP_SEGMENT] --no-git-tag-version
```

1. **Commit** the version bump:

```powershell
# Guard: confirm we're on the Epic branch before committing the bump.
node .agents/scripts/assert-branch.js --expected epic/[EPIC_ID]

# Stage only the version-bump artefacts (never `git add .`).
git add package.json package-lock.json [release.versionFile]
git commit -m "chore(release): bump version to [NEW_VERSION] for Epic #[EPIC_ID]"
```

1. **Tag** the release:

```powershell
git tag -a "v[NEW_VERSION]" -m "Release v[NEW_VERSION]: Epic #[EPIC_ID] — [Epic Title]"
```

> **Note:** The tag is created on the Epic branch before the merge so it travels
> with the merge commit into `[BASE_BRANCH]`. The tag is pushed in Step 7
> alongside `[BASE_BRANCH]`.

## Step 4 — Pre-Merge Validation

Ensure the code is stable and passes all quality gates on the Epic branch before
merging to `main`.

```powershell
npm run lint; npm test
```

If the build fails: **STOP**. Fix the regressions on a hotfix branch and merge
back into the Epic branch before restarting this workflow.

## Step 5 — Merge Epic Branch to Main

```powershell
git checkout [BASE_BRANCH]
git pull origin [BASE_BRANCH]
git merge --no-ff epic/[EPIC_ID] -m "chore(release): merge epic/[EPIC_ID] into [BASE_BRANCH]"
```

## Step 6 — Conflict Marker Scan

```powershell
node [SCRIPTS_ROOT]/detect-merges.js
```

If markers are found: resolve them following the canonical procedure in
[`_merge-conflict-template.md`](_merge-conflict-template.md), stage with
`git add`, and amend the merge commit before proceeding.

## Step 7 — Push Main & Tags

```powershell
git push origin [BASE_BRANCH] --follow-tags
```

## Step 8 — Close Planning, Strategy, and Epic Tickets

Formally close the PRD and Tech Spec tickets, followed by the Epic itself.

```powershell
node [SCRIPTS_ROOT]/sprint-close.js --epic [EPIC_ID]
```

This automated script performs:

1. **Discovery**: Finds and closes `context::prd`, `context::tech-spec`, and
   `type::health` (Sprint Health dashboard) tickets for this Epic. These
   auxiliary tickets hold no planned work — they exist to stage or track the
   sprint — and are closed together so the Epic does not retain open children
   after closure.
2. **Epic Closure**: Posts a final summary comment and closes the Epic issue.
3. **Cleanup**: Deletes all local and remote branches associated with this Epic
   (can be disabled with `--no-cleanup`). Cleanup reaps stale story worktrees
   and prunes stale worktree registrations before branch deletion.

## Step 9 — Verify Closure

Manually verify that the Epic and all context tickets are closed in the GitHub
UI. Check the notification structured comment on the Epic for the final shipping
announcement.

## Step 10 — Verify Tag (If Applicable)

If a version bump was performed in Step 3, confirm the tag exists on the remote:

```powershell
git ls-remote --tags origin "v[NEW_VERSION]"
```

If the tag is missing (e.g., `--follow-tags` was not used), push it explicitly:

```powershell
git push origin "v[NEW_VERSION]"
```

## Step 11 — Internal State Cleanup

If you ran Step 8 with `--no-cleanup`, or need to perform manual cleanup, run:
`node [SCRIPTS_ROOT]/sprint-close.js --epic [EPIC_ID]` without the flag to clean
up branches.

> **Windows/PowerShell Resilience:** Remote branch deletions are individually
> wrapped in error handling inside `sprint-close.js`. A "branch not found" error
> on any single remote ref will be logged as a warning but will **not** abort
> the cleanup pass — all remaining branches are still attempted.

## Constraint

- **Never** merge to `main` if any child ticket (Task, Story, Feature) is still
  open — the Completeness Gate in Step 1 is mandatory.
- **Never** skip the Documentation Freshness Gate (Step 2). Every file in
  `[ALL_DOCS]` **must** show a diff against `[BASE_BRANCH]` before the merge
  proceeds. If a file has no changes, update it.
- **Never** skip the pre-merge validation (lint + test). A broken `main` branch
  blocks all future Epics.
- **Always** auto-invoke `/sprint-code-review` (Step 1.4) and `/sprint-retro`
  (Step 1.5) from inside `/sprint-close` when they have not already produced
  their respective artefacts. Do not halt and ask the operator to run them
  separately — that round-trip is what v5.8.7 removed.
- **Always** bump the version and create the git tag (Step 3) before merging
  when `release.autoVersionBump` is `true`. Use **minor** for new features,
  **patch** for fixes and refactors.
- **Always** run `sprint-close.js` (Step 8) to ensure PRD and Tech Spec tickets
  are formally closed — they are excluded from auto-closure during execution.
- **Always** delete all Epic, Task, and Story branches after merge to prevent
  branch bloat. Individual remote deletion failures MUST be tolerated — log them
  as warnings and continue.
- **Always** tag a release when the Epic corresponds to a versioned milestone.

## Step 12 — Notification

```powershell
node [SCRIPTS_ROOT]/notify.js --ticket [EPIC_ID] "Epic #[EPIC_ID] closed. Merged to [BASE_BRANCH] and branches cleaned up." --action
```
