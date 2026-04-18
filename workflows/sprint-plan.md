---
description:
  Orchestrates end-to-end sprint planning (PRD, Tech Spec, and Work Breakdown)
  for a GitHub Epic.
---

# /sprint-plan [Epic ID]

## Role

Director / Architect

## Context

You are the master orchestrator for the v5 Epic-Centric ticketing pipeline. Your
goal is to transform a high-level Epic into a fully decomposed, ready-to-execute
backlog of Features, Stories, and Tasks.

As of v5.6, planning artifacts (PRD, Tech Spec, ticket decomposition) are
authored **directly by you, the host LLM** — no external Gemini / Anthropic /
OpenAI API is called. The Node scripts are deterministic GitHub I/O wrappers
that (a) emit the authoring context you need and (b) validate and persist the
artifacts you author.

## Constraint

- Do not modify existing issues without explicit permission.
- Wait for user validation before migrating to Phase 2.

## Prerequisites

1. **GitHub Epic**: An existing GitHub Issue with the `type/epic` label.
2. **API Keys**: `GITHUB_TOKEN` must be set in the `.env` file.

## Phase 0: Re-Plan Detection

Before generating any artifacts, check whether the Epic has already been
planned.

1. **Fetch Epic**: Read the Epic issue body and check for a
   `## Planning Artifacts` section containing PRD and Tech Spec references.
2. **If already planned**: Inform the user that this Epic already has planning
   artifacts. Ask:

   > "Epic #[ID] already has PRD (#XX) and Tech Spec (#XX) with YY decomposed
   > tickets. Do you want to **re-plan** from scratch? This will close the old
   > PRD, Tech Spec, and all Feature/Story/Task tickets and regenerate them."

3. **If user confirms re-plan**: Pass `--force` to all subsequent script
   invocations.
4. **If user declines**: Abort gracefully.

## Phase 1: Epic Planning (PRD & Tech Spec)

> **Parallel-safe file naming.** Multiple Epics may be planned or decomposed
> concurrently. Every temp file written in this workflow MUST include the Epic
> ID in its name (e.g. `temp/planner-context-epic-[Epic_ID].json`,
> `temp/prd-epic-[Epic_ID].md`, `temp/techspec-epic-[Epic_ID].md`,
> `temp/decomposer-context-epic-[Epic_ID].json`,
> `temp/tickets-epic-[Epic_ID].json`). Do **not** reuse bare names like
> `temp/prd.md` — they will collide with another agent's run.

1. **Gather Authoring Context**: Run the Epic Planner in context-emission mode
   to fetch the Epic body, scraped project docs, and the recommended system
   prompts.

   ```bash
   node .agents/scripts/epic-planner.js --epic [Epic_ID] --emit-context > temp/planner-context-epic-[Epic_ID].json
   ```

2. **Author the PRD**: Read `temp/planner-context-epic-[Epic_ID].json`. Using
   the `systemPrompts.prd` guidance combined with the Epic title/body, write the
   PRD markdown to `temp/prd-epic-[Epic_ID].md`. Keep it to the four-section
   structure (Context & Goals, User Stories, Acceptance Criteria, Out of Scope)
   and start the document with `## Overview` (no `<h1>`).

3. **Author the Tech Spec**: Using `systemPrompts.techSpec`, the PRD you just
   wrote, and `docsContext`, write the Tech Spec to
   `temp/techspec-epic-[Epic_ID].md`. Start with `## Technical Overview` (no
   `<h1>`).

4. **Persist to GitHub**:

   ```bash
   # Normal planning
   node .agents/scripts/epic-planner.js --epic [Epic_ID] \
     --prd temp/prd-epic-[Epic_ID].md \
     --techspec temp/techspec-epic-[Epic_ID].md

   # Re-planning (force regeneration)
   node .agents/scripts/epic-planner.js --epic [Epic_ID] \
     --prd temp/prd-epic-[Epic_ID].md \
     --techspec temp/techspec-epic-[Epic_ID].md --force
   ```

5. **Verification**:
   - Verify that the PRD and Technical Specification have been posted as linked
     issues under the Epic.
   - **STOP**: Ask the USER to review the generated PRD and Tech Spec on GitHub.
     Do NOT proceed to decomposition until the user confirms the plan is
     accurate.

6. **Cleanup**: Once the PRD/Tech Spec issues are confirmed on GitHub, delete
   the Phase 1 temp files for this Epic so later runs don't mix artifacts:

   ```powershell
   Remove-Item -Force -ErrorAction SilentlyContinue `
     "temp/planner-context-epic-[Epic_ID].json", `
     "temp/prd-epic-[Epic_ID].md", `
     "temp/techspec-epic-[Epic_ID].md"
   ```

## Phase 2: Work Breakdown Decomposition

1. **Gather Decomposition Context**:

   ```bash
   node .agents/scripts/ticket-decomposer.js --epic [Epic_ID] --emit-context > temp/decomposer-context-epic-[Epic_ID].json
   ```

2. **Author the Ticket Array**: Read
   `temp/decomposer-context-epic-[Epic_ID].json` — it contains the PRD body,
   Tech Spec body, risk heuristics, the decomposer system prompt, and a
   `maxTickets` cap (configurable in `.agentrc.json`, default 40). Produce a
   JSON array of Feature/Story/Task objects conforming to the schema in the
   system prompt and write it to `temp/tickets-epic-[Epic_ID].json`.

3. **Persist to GitHub**:

   ```bash
   # Normal decomposition
   node .agents/scripts/ticket-decomposer.js --epic [Epic_ID] \
     --tickets temp/tickets-epic-[Epic_ID].json

   # Re-planning (close old tickets first)
   node .agents/scripts/ticket-decomposer.js --epic [Epic_ID] \
     --tickets temp/tickets-epic-[Epic_ID].json --force
   ```

4. **Cross-Validation**:
   - **Verify**: every PRD feature -> Feature issue -> at least one Story -> at
     least one Task.
   - **Verify**: dependency DAG across Tasks is acyclic (no circular deps).
   - **Verify**: risk::high Tasks are flagged correctly.
   - **Action**: Fix any gaps by creating additional issues or updating existing
     ones manually.

5. **Audit**:
   - Check the Epic's comment thread to ensure the backlog summary was posted.
   - Verify that at least one `type/feature`, `type/story`, and `type/task`
     issue was created.

6. **Cleanup**: Once the backlog is confirmed on GitHub, delete the Phase 2 temp
   files for this Epic:

   ```powershell
   Remove-Item -Force -ErrorAction SilentlyContinue `
     "temp/decomposer-context-epic-[Epic_ID].json", `
     "temp/tickets-epic-[Epic_ID].json"
   ```

## Phase 3: Notification & Handoff

1. **Notify Operator (INFO)**:
   - Post a summary comment on the Epic issue with work breakdown stats.
   - @mention the operator (informational — no webhook for planning) by running
     the notification script:

   ```bash
   node .agents/scripts/notify.js [Epic_ID] "Planning complete, review tickets. Backlog decomposition complete. Sprint is ready for /sprint-execute." --action
   ```

## Phase 4: Execution Roadmap (Story Dispatch)

1. **Generate Roadmap**: Automatically invoke the dispatcher in dry-run mode to
   calculate execution waves and model recommendations:

   ```bash
   node .agents/scripts/dispatcher.js --epic [Epic_ID] --dry-run
   ```

2. **Verify Output**:
   - Confirm the **Story Dispatch Table** is printed.
   - Check for any stories in **Wave 0** — these are ready for immediate
     execution.

   > **Manifest persistence (v5.9.0):** the dispatcher also posts the manifest
   > as a `dispatch-manifest` structured comment on the Epic (idempotent —
   > re-runs replace the prior comment). That comment is the source of truth for
   > the Wave Completeness Gate in `/sprint-close` Step 0.5 and for any external
   > wave-tracking tooling.

3. **Handoff**: Provide the user with the recommended next step:

   > "Planning is complete. Select a story from Wave 0 in the table above and
   > start execution via `/sprint-execute #[Story ID]` using the recommended
   > model."

## Phase 5: Readiness Health Check

Run the post-plan health check to validate the backlog and prime the execution
environment. This is non-blocking — it reports findings but does not fail the
plan.

```bash
node .agents/scripts/sprint-plan-healthcheck.js --epic [Epic_ID]
```

The health check verifies:

1. **Ticket hierarchy** — Features, Stories, and Tasks exist with correct labels
   and no dependency cycles.
2. **Git remote** — origin is reachable and the base branch exists.
3. **Config** — `.agentrc.json` orchestration block passes validation.
4. **pnpm store** _(only if `nodeModulesStrategy: 'pnpm-store'`)_ — runs
   `pnpm install --frozen-lockfile` in the project root to populate the global
   content-addressable store. This makes subsequent worktree installs
   near-instant instead of downloading packages from scratch.

If the health check reports errors, review them before starting execution.
Warnings are advisory and do not require action.

## Troubleshooting

- If `epic-planner.js --emit-context` fails, confirm the Epic exists and has a
  body with enough initial context.
- If `ticket-decomposer.js` rejects the tickets file, re-read the validator's
  error message — the most common causes are a Story with no child Tasks, a Task
  whose `parent_slug` does not point at a Story, or cross-Story Task
  dependencies (which must be lifted to Story-level dependencies).
