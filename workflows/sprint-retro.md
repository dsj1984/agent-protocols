---
description: >-
  Perform Sprint Retrospective, reading data from the Epic ticket graph and
  friction logs, then post the retro as a structured comment on the Epic issue
  (the retro is no longer written to a local file).
---

# Sprint Retro & Roadmap Alignment

This workflow generates a sprint retrospective by reading execution data
directly from the GitHub ticket graph and **posts the result as a comment on the
Epic issue**. Local `docs/retros/` is no longer used — GitHub is the sole retro
archive.

> **Persona**: `product` · **Model**: `planningFallback` from `.agentrc.json`
> **Skills**: `core/documentation-and-adrs`, `core/idea-refinement`

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic that was just
   completed.
2. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json`.

> **Storage has moved.** The retro is posted as a structured comment on the Epic
> issue — there is no longer a `retroPath` or a local file to produce. The
> comment is greppable via
> `gh api repos/{owner}/{repo}/issues/[EPIC_ID]/comments` and survives branch
> pruning, repo moves, and local cleanups.

## Step 1 — Gather Retrospective Data from the Ticket Graph

Read execution telemetry directly from GitHub — **not** from local files:

1. **Fetch the Epic and all child tickets** (Features, Stories, Tasks) using
   `provider.getTickets(epicId)`.
2. **For each Task ticket**, collect:
   - Final label state (e.g., `agent::done`, `risk::high`, `status::blocked`).
   - All comments of type `friction` (posted via `postStructuredComment`).
   - Time between `agent::executing` and `agent::done` (from label events, if
     available).
3. **Collect aggregate friction signals**:
   - Count of Tasks that required a hotfix (`status::blocked` was applied).
   - Count of Tasks that hit the HITL gate (`risk::high`).
   - Count of Tasks that required more than one integration attempt.

## Step 2 — Compose the Retrospective Markdown

Produce the retro body (in memory — do **not** write to disk) with this
structure. The leading title line is the **retro marker** that `/sprint-close`'s
Retrospective Gate uses to detect whether a retro has already been posted.

```markdown
## 🪞 Sprint Retrospective — Epic #[EPIC_ID]: [Epic Title]

_Generated [ISO date] · Protocol Version [from .agents/VERSION]_

### Sprint Scorecard

| Metric                    | Value |
| ------------------------- | ----- |
| Total Tasks               |       |
| Tasks Completed First Try |       |
| Tasks Requiring Hotfix    |       |
| HITL Gates Triggered      |       |
| Friction Events           |       |

### What Went Well

> (Analyse Task ticket labels and comments for smooth execution patterns)

### What Could Be Improved

> (Identify Tasks with friction comments; extract root causes)

### Architectural Debt

> (List any patterns introduced that deviate from established ADRs)

### Protocol Optimization Recommendations (Self-Healing)

> MUST: Identify systemic friction points and propose agent-ready markdown
> snippets or skill updates for the agent-protocols library.

### Action Items for Next Epic

> Clear, actionable items derived from the retro analysis.
```

The `## 🪞 Sprint Retrospective — Epic #[EPIC_ID]` heading **must** appear
verbatim at the top — the close-workflow gate greps for this prefix on the
Epic's comment thread to verify the retro ran.

## Step 3 — Post the Retrospective as an Epic Comment

Post the composed markdown as a comment on the Epic issue, tagged with the
`retro` structured type.

```powershell
# Preferred (structured, includes marker for sprint-close gate):
node [SCRIPTS_ROOT]/notify.js [EPIC_ID] "<retro markdown>" --type retro

# MCP-native alternative:
# provider.postComment(epicId, { body: "<retro markdown>", type: "retro" })
```

Record the returned comment URL — the caller (typically `/sprint-close`) may
echo it in its summary.

### Fallback on network failure

If the comment post fails (network / 4xx / 5xx), dump the retro body to
`temp/retro-epic-[EPIC_ID].md` so the content is not lost and surface a clear
error. The operator can re-run `/sprint-retro [EPIC_ID]` after resolving
connectivity. **Never** leave the file as the permanent artifact — re-run and
delete the temp file once the comment lands.

## Step 4 — Update Architecture & Patterns Documentation (Optional)

If the Epic introduced cross-cutting architectural decisions, update the
supporting docs in the same session:

- Update `docs/architecture.md` if any core schemas or dependencies were
  introduced during this Epic.
- Update `docs/decisions.md` to capture key architectural decisions made during
  implementation.

Commit these with a conventional `docs(...)` message on the Epic branch. Do
**not** stage or commit the retro itself — it lives only on GitHub.

## Step 5 — Roadmap Sync (Handled Elsewhere)

The roadmap is synced from GitHub Epics by `/sprint-close` (Step 2.5). No action
here.

> **Note:** Do NOT add new protocol-related action items to the roadmap; these
> belong inside the Epic comment retro for later implementation in the
> `agent-protocols` repository.

## Constraint

- **Never** write the retro to `docs/retros/` or any other local path as the
  permanent artifact. GitHub Epic comments are the source of truth.
- **Never** skip the `## 🪞 Sprint Retrospective — Epic #[EPIC_ID]` heading line
  — `/sprint-close`'s gate depends on it.
- **Always** post the retro as `type: retro` (via `notify.js --type retro` or
  the structured comment API) so downstream tooling can filter it.
- **Always** re-run the workflow end-to-end if the comment post fails — the temp
  dump in Step 3 is a recovery aid, not a ship vehicle.
- Do **not** mark items as implemented in `ROADMAP.md` unless they have passed
  all QA test cases and the Code Review audit for this Epic. GitHub is the
  Single Source of Truth in v5 — all execution data must be sourced from the
  ticket graph.
