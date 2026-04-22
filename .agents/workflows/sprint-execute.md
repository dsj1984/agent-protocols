---
description: >-
  Execute a sprint ticket. Routes by `type::` label — `type::epic` fans out
  wave-based orchestration via the epic runner; `type::story` runs a single
  Story end-to-end (init → implement → validate → close, per-story worktree
  when isolation is enabled).
---

# /sprint-execute #[Ticket ID]

## Overview

`/sprint-execute` is the **single entry point** for sprint execution. It
routes by the ticket's `type::` label:

| Label         | Mode                 | What runs                                                    |
| ------------- | -------------------- | ------------------------------------------------------------ |
| `type::epic`  | **Epic Mode**        | Long-running orchestrator — fans out Stories wave-by-wave.   |
| `type::story` | **Story Mode**       | Single-Story worker — init, implement Tasks, validate, close.|
| `type::feature` / `type::task` | Rejected | Features are containers; Tasks are child items.              |

Both modes share the same dispatcher entry point at
[`.agents/scripts/dispatcher.js`](../scripts/dispatcher.js), which auto-detects
the ticket type via `resolveAndDispatch`. This workflow is the human/agent
counterpart — the prose instructions Claude follows per mode.

---

## Step 0 — Identify the ticket type

Fetch the ticket and inspect its labels before branching into a mode.

```powershell
# Via MCP (preferred when available)
mcp__github__issue_read owner=<owner> repo=<repo> method=get issue_number=<ticketId>

# Or via gh CLI
gh issue view <ticketId> --json labels,title
```

- If labels contain `type::epic` → follow **Epic Mode** below.
- If labels contain `type::story` → follow **Story Mode** below.
- If labels contain `type::feature` → **STOP**. Features are containers; run
  `/sprint-execute` against individual Stories or the parent Epic instead.
- If labels contain `type::task` → **STOP**. Tasks execute as children of
  Stories, never directly.

---

## Epic Mode (`type::epic`)

### Epic Mode overview

Epic Mode is the **long-running orchestrator** that composes Story sub-agents
across every wave of an Epic. It is the entry point for the remote-agent
dispatch flow (fired from `.github/workflows/epic-dispatch.yml`) and can also
be invoked locally for manual end-to-end runs.

> **Engine**: coordinator at
> `.agents/scripts/lib/orchestration/epic-runner.js` composes the six
> submodules in `.agents/scripts/lib/orchestration/epic-runner/` (wave-scheduler,
> story-launcher, state-poller, checkpointer, blocker-handler,
> notification-hook, and a bookend-chainer stub). The CLI at
> `.agents/scripts/epic-runner.js` drives the engine with the
> `orchestration.epicRunner` block from `.agentrc.json`.

### Contract

- **Argument**: a single **Epic ID** (`type::epic`). Story IDs take the other
  branch of this workflow.
- **Idempotent by checkpoint**: resumes from the `epic-run-state` structured
  comment if present; otherwise initializes a fresh run.
- **Single pause point**: only `agent::blocked` halts execution. All other
  labels are informational during the run.
- **Snapshot modifier**: `epic::auto-close` is read once at run start. Adding
  it mid-run is ignored; removing it mid-run is ignored.

### Invocation

```bash
node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]
```

The skill drives that CLI. Inside the remote-agent environment, it is invoked
indirectly by `.agents/scripts/remote-bootstrap.js` after the workspace is
provisioned.

### Flow

1. **Startup**: flip Epic to `agent::executing`, snapshot `autoClose`, write
   initial `epic-run-state` checkpoint comment.
2. **Per wave**: compute wave N via `Graph.computeWaves()`, launch up to
   `orchestration.epicRunner.concurrencyCap` parallel Story sub-agents (each
   invokes `/sprint-execute <storyId>` under the hood), poll every
   `pollIntervalSec`, write wave-end comment, advance.
3. **Blocker**: flip Epic to `agent::blocked`, post friction comment, fire
   webhook, park until the operator flips back to `agent::executing`.
4. **Final wave completes**: flip Epic to `agent::review`.
5. **If `autoClose` was set**: chain `/sprint-code-review` →
   `/sprint-retro` → `/sprint-close`. Otherwise exit cleanly for the operator
   to drive the bookends manually.

> 📎 See tech spec **#323** for the full component diagram, failure model,
> `epic-run-state` schema, and `.agentrc.json` keys under
> `orchestration.epicRunner`.

---

## Story Mode (`type::story`)

### Story Mode overview

Story Mode is a **single-purpose worker**. One invocation runs one Story from
init to close. The argument is always a **Story ID**.

For the Epic-level view — waves, recommended models, parallel suggestions —
see the Story Dispatch Table emitted by `/sprint-plan` (Phase 4). Run one
`/sprint-execute <Story ID>` per Claude window; the operator owns launch order
by picking stories off the Dispatch Table.

> **Worktree isolation.** When `orchestration.worktreeIsolation.enabled` is
> `true`, Step 0 ensures a worktree at `.worktrees/story-<id>/` and prints its
> absolute path as `workCwd`. You **must** `cd` into that path before Step 1.
> The main checkout's HEAD is never moved. When isolation is `false`, `workCwd`
> equals the main checkout. See
> [`worktree-lifecycle.md`](worktree-lifecycle.md) for node_modules strategies,
> Windows notes, and escape hatches.

### Step 0 — Initialize (`sprint-story-init.js`)

Run the initialization script from the **main checkout**. It sets up the Epic
branch, seeds the Story branch, creates the worktree (if enabled), and
transitions child Tasks to `agent::executing`.

```powershell
node .agents/scripts/sprint-story-init.js --story <storyId>
```

The script:

- Fetches the Story ticket and validates it's a `type::story`.
- Checks blockers — **exits non-zero** if any `blocked by` are open.
- Traces the hierarchy (Feature → Epic → PRD / Tech Spec).
- Enumerates child Tasks in dependency order.
- Bootstraps the Epic branch if missing (in main checkout).
- **Worktree-enabled path**: seeds the `story-<id>` branch ref from the Epic
  branch without moving main's HEAD, then `git worktree add` at
  `.worktrees/story-<id>/`.
- **Single-tree fallback**: checks out the story branch in the main checkout.
- Batch-transitions all child Tasks to `agent::executing`.

**Output**: structured JSON. Key fields for the agent:

- `workCwd` — absolute path where you run all subsequent commands.
- `worktreeEnabled` — whether worktree isolation is active.
- `tasks[]` — dependency-ordered list of child Tasks to implement.
- `context.prdId`, `context.techSpecId` — fetch these before coding.

> **Dry-run**: Add `--dry-run` to check status without git or ticket changes. No
> worktree is created.

#### Step 0.5 — `cd` into the workCwd and verify dependencies

```powershell
cd "<workCwd from Step 0 result>"
```

All subsequent git commands, test runs, and Step 3 closure run from this
directory. In worktree-enabled mode this is `.worktrees/story-<id>/`; in
single-tree mode it is the main checkout.

**Dependency install:** When worktree isolation is enabled, the worktree is a
fresh checkout with no `node_modules/`. Step 0 runs `npm ci` (or the lock-file
appropriate equivalent) automatically during worktree creation. If `workCwd`
has no `node_modules/` directory, run install before proceeding:

```powershell
npm ci    # or: pnpm install --frozen-lockfile / yarn install --frozen-lockfile
```

> **Model Selection**: check the **Story Dispatch Table** from `/sprint-plan`
> for this Story's **Model Tier** (`high` or `low`). Pick any model whose
> reasoning strength matches the tier — the concrete choice is left to the
> operator/router.

### Step 1 — Implementation (Sequential Task Loop)

For **each child Task** in the order returned by `sprint-story-init.js`:

1. Read the full `## Instructions` section of the Task ticket.
2. Implement all described changes strictly within the scope of the Story
   branch.
3. Commit after each Task. Even inside an isolated worktree, keep the
   assert-branch guard — it's cheap defense-in-depth against the agent drifting
   off the story branch (e.g. from a `git checkout` buried in a tool script).

   ```powershell
   # 1. Guard: halt if HEAD drifted off story-<id>.
   node .agents/scripts/assert-branch.js --expected story-<storyId> --cwd .

   # 2. Stage: prefer explicit paths for the files you edited in this Task.
   git add <path/one> <path/two>
   # Or, for tracked edits only:
   # git add -u

   git commit --no-verify -m "feat(<scope>): <task title> (resolves #<taskId>)"
   ```

4. Proceed to the next Task in the Story.

> If a commit runs into a merge conflict during a rebase, follow the canonical
> procedure in [`_merge-conflict-template.md`](_merge-conflict-template.md).

### Step 2 — Validate

After all Tasks are implemented, run shift-left validation in the worktree:

```powershell
npm run lint
npm test
```

If tests or lint fail:

- Fix the issues and commit corrections.
- If blocked (e.g. upstream dependency missing): post a friction comment and
  apply `status::blocked`.

### Step 3 — Close (`sprint-story-close.js`)

Run closure. Pass the main-checkout path via `--cwd` so the merge and branch
deletion run against the main repo, not inside the worktree (branches checked
out in a worktree cannot be deleted from themselves). The close script will
reap the worktree after the merge succeeds.

```powershell
# From the worktree, invoke close against the main checkout.
node <main-repo>/.agents/scripts/sprint-story-close.js --story <storyId> --cwd <main-repo>
```

In single-tree mode, `--cwd` can be omitted (defaults to `PROJECT_ROOT`).

The script:

- Checks for `risk::high` — if set, the script prints a HITL prompt to stderr
  and exits non-zero **without** creating a PR, pushing the branch, merging, or
  posting any comment. **You (the agent) MUST stop here and present the three
  options in chat**, then wait for the operator to reply with one of:
  - `Proceed` or `Proceed Option 1` — **auto-merge.** The agent (not the
    operator) removes the `risk::high` label programmatically via
    `node .agents/scripts/update-ticket-state.js --ticket <storyId> --remove-label risk::high`
    (or the equivalent MCP call), then re-runs `sprint-story-close.js` for this
    story.
  - `Proceed Option 2` — **manual merge.** The agent stops. The operator
    inspects the diff and merges the story branch by hand. The agent takes no
    further action on this story.
  - `Proceed Option 3` — **reject / rework.** The agent stops. The operator
    opens follow-up tickets by hand.

  Do not take any action before the operator replies with one of those four
  phrases. The gate can be disabled globally via
  `orchestration.hitl.riskHighApproval: false`.

- Merges the Story branch into `epic/<epicId>` with `--no-ff`.
- Pushes the Epic branch.
- Deletes the Story branch (local + remote).
- **Reaps the worktree** (`.worktrees/story-<id>/`) via `WorktreeManager.reap` —
  refuses if uncommitted or unmerged.
- Batch-transitions all child Tasks and the Story to `agent::done`.
- Runs `cascadeCompletion()` to propagate closure up the hierarchy.
- Runs `health-monitor.js` to update sprint metrics.
- Regenerates the Epic dispatch manifest (`temp/dispatch-manifest-<epicId>.md` /
  `.json`). Pass `--skip-dashboard` to suppress.

**Output**: structured JSON with `ticketsClosed[]`, `cascadedTo[]`, worktree
reap status.

> **Why not use GitHub auto-close?** GitHub's `Closes #N` only fires when
> merging into the repo's default branch. Story branches merge into
> `epic/<epicId>`, so we close tickets explicitly via the state writer.

### Parallel execution

Run two Stories at once by opening two Claude windows and invoking
`/sprint-execute <id>` in each. With `worktreeIsolation.enabled: true` each
window gets its own `.worktrees/story-<id>/`; the main checkout stays quiet.
Pick the story IDs from the Dispatch Table produced by `/sprint-plan`.

Focus-area / file-overlap conflicts are the **operator's** responsibility —
read the Dispatch Table before launching. The framework no longer serializes
waves automatically.

---

## Constraint

### Epic Mode

- **Never** honor a mid-run change to `epic::auto-close`. The snapshot at
  startup is authoritative.
- **Always** checkpoint via `post_structured_comment` with the
  `epic-run-state` marker — never write run state anywhere else.
- **Never** launch more than `concurrencyCap` parallel Story executors per
  wave.

### Story Mode

- **Never** push Story branch work directly to `main`.
- **Never** merge across Story branches — each Story is self-contained.
- **Always** `cd` into the `workCwd` returned by Step 0 before editing.
- **Always** verify `git branch --show-current` outputs the expected Story
  branch name before making any commits. If it does not, **STOP**.
- **Always** validate (lint + test) before running Step 3.
- **Always** pass `--cwd <main-repo>` to `sprint-story-close.js` when invoking
  from inside a worktree, so the merge runs in the main repo.
- **Always** run cascadeCompletion after merging — GitHub cannot auto-close
  tickets on non-default branch merges.
- **Always** delete the Story branch (local + remote) after merging into the
  Epic branch. `sprint-story-close.js` does this for you.
- **MCP Fallback**: If `agent-protocols` MCP tools fail due to connection
  errors, **fall back immediately** to
  `node .agents/scripts/update-ticket-state.js --task <id> --state <state>`
  (which also auto-cascades completion when `--state agent::done`). Do not
  leave tickets in stale states.
