---
description: >-
  Final Epic closure — merge the Epic base branch to main, close the Epic issue
  via GitHub provider, clean up branches, and tag a release.
---

# Sprint Close

This workflow is the **terminal step** of the Epic lifecycle. It promotes the
fully integrated and reviewed `epic/<epicId>` branch into `main`, closes the
Epic GitHub issue, cleans up all sprint branches, and optionally tags a release.

> **When to run**: After `/sprint-code-review` and `/sprint-retro` are complete.
> The Code Review is a **mandatory pre-merge gate** — never run `/sprint-close`
> without it.
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

## Step 1 — Completeness Gate (Hierarchy Check)

Before executing any git operations, verify ALL child items under the Epic are
successfully closed:

1. **Tasks**: Must all be `agent::done` and closed.
2. **Stories**: Must all be closed.
3. **Features**: Must all be closed.

If ANY child ticket is not closed: **STOP IMMEDIATELY.** Alert the operator with
the exact open IDs.

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

## Step 2.5 — Roadmap Sync

Synchronize `ROADMAP.md` with the current state of all GitHub Epics. This
ensures the roadmap reflects the Epic that is about to close as `✅ Completed`,
along with accurate progress for any other open Epics.

Run the `/roadmap-sync` workflow inline — execute Steps 0 through 3 of that
workflow, but **skip Step 4 (Commit)**. The roadmap changes will be committed
as part of the next documentation commit or the merge itself.

```powershell
git add [ROADMAP_PATH]
```

> **Config:** The roadmap output path is controlled by `roadmapPath` in
> `.agentrc.json` (default: `docs/ROADMAP.md`). Epics labeled with any value
> from `roadmap.excludeLabels` are omitted.

## Step 3 — Version Bump & Tag

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
git add .
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

// turbo

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

If markers are found: resolve them, stage with `git add`, and amend the merge
commit before proceeding.

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

1. **Discovery**: Finds and closes `context::prd` and `context::tech-spec`
   tickets for this Epic.
2. **Epic Closure**: Posts a final summary comment and closes the Epic issue.
3. **Cleanup**: Deletes all local and remote branches associated with this Epic
   (can be disabled with `--no-cleanup`).

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
`node [SCRIPTS_ROOT]/sprint-close.js --epic [EPIC_ID]` without the flag to clean up branches.

## Constraint

- **Never** merge to `main` if any child ticket (Task, Story, Feature) is still
  open — the Completeness Gate in Step 1 is mandatory.
- **Never** skip the Documentation Freshness Gate (Step 2). Every file in
  `[ALL_DOCS]` **must** show a diff against `[BASE_BRANCH]` before the merge
  proceeds. If a file has no changes, update it.
- **Never** skip the pre-merge validation (lint + test). A broken `main` branch
  blocks all future Epics.
- **Always** bump the version and create the git tag (Step 3) before merging
  when `release.autoVersionBump` is `true`. Use **minor** for new features,
  **patch** for fixes and refactors.
- **Always** run `sprint-close.js` (Step 8) to ensure PRD and Tech Spec tickets
  are formally closed — they are excluded from auto-closure during execution.
- **Always** delete all Epic, Task, and Story branches after merge to prevent
  branch bloat.
- **Always** tag a release when the Epic corresponds to a versioned milestone.

## Step 12 — Notification

```powershell
node [SCRIPTS_ROOT]/notify.js "Epic #[EPIC_ID] closed. Merged to [BASE_BRANCH] and branches cleaned up." --action
```
