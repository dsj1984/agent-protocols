---
description: >-
  Perform Sprint Retrospective, reading data from the Epic ticket graph and
  friction logs to generate a structured retrospective document.
---

# Sprint Retro & Roadmap Alignment

This workflow generates a sprint retrospective by reading execution data
directly from the GitHub ticket graph. It is a **Bookend Lifecycle** phase,
executed automatically by `/sprint-execute` after Code Review completes, or run
manually by the operator.

> **Persona**: `product` · **Model**: `planningFallback` from `.agentrc.json`
> **Skills**: `core/documentation-and-adrs`, `core/idea-refinement`

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic that was just
   completed.
2. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json`.

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

## Step 2 — Generate Retrospective Document

Generate a `retro-epic-[EPIC_ID].md` file in the `[BASE_BRANCH]` docs root using
the following structure:

```markdown
# Retrospective — Epic #[EPIC_ID]: [Epic Title]

**Date**: [ISO date] **Protocol Version**: [from .agents/VERSION]

## Sprint Scorecard

| Metric                    | Value |
| ------------------------- | ----- |
| Total Tasks               |       |
| Tasks Completed First Try |       |
| Tasks Requiring Hotfix    |       |
| HITL Gates Triggered      |       |
| Friction Events           |       |

## What Went Well

> (Analyse Task ticket labels and comments for smooth execution patterns)

## What Could Be Improved

> (Identify Tasks with friction comments; extract root causes)

## Architectural Debt

> (List any patterns introduced that deviate from established ADRs)

## Protocol Optimization Recommendations (Self-Healing)

> MUST: Identify systemic friction points and propose agent-ready markdown
> snippets or skill updates for the agent-protocols library.

## Action Items for Next Epic

> Clear, actionable items derived from the retro analysis.
```

## Step 3 — Update Roadmap (If Applicable)

The roadmap is automatically synced from GitHub Epics via the `/roadmap-sync`
workflow. This runs as part of `/sprint-close` (Step 2.5), so no manual roadmap
updates are needed during the retrospective.

> **Note:** Do NOT add new protocol-related action items to the roadmap; these
> belong in the retro document for later implementation in the `agent-protocols`
> repository.

## Step 4 — Update Architecture & Patterns Documentation

- Update `docs/architecture.md` if any core schemas or dependencies were
  introduced during this Epic.
- Update `docs/decisions.md` to capture key architectural decisions made during
  implementation.

## Step 5 — Commit

```powershell
git add docs/retro-epic-[EPIC_ID].md docs/architecture.md docs/decisions.md
git commit --no-verify -m "docs(retro): Epic #[EPIC_ID] retrospective and documentation update"
git push origin [BASE_BRANCH]
```

## Step 6 — Post Summary to Epic Ticket

Post a structured comment on the Epic ticket linking to the retro document:

```javascript
// postStructuredComment([EPIC_ID], 'progress',
//   'Retrospective complete. See docs/retro-epic-[EPIC_ID].md for the full report.')
```

## Constraint

Do **not** mark items as implemented in `roadmap.md` unless they have passed all
QA test cases and the Code Review audit for this Epic. Do **not** read from
local playbook files — GitHub is the Single Source of Truth in v5. All execution
data must be sourced from the ticket graph.
