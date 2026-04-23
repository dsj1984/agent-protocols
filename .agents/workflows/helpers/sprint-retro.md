---
description: >-
  Perform Sprint Retrospective, reading data from the Epic ticket graph and
  friction logs, then post the retro as a structured comment on the Epic issue
  (the retro is no longer written to a local file).
---

# Sprint Retro (helper)

> **Helper module.** Not a slash command. Invoked automatically from
> `/sprint-close` Phase 5.1 when the Epic has no retro comment yet. To run a
> retro directly, use `/sprint-close [Epic_ID]` — it delegates here (or pass
> `--skip-retro` to bypass).

This helper generates a sprint retrospective by reading execution data
directly from the GitHub ticket graph and **posts the result as a comment on the
Epic issue**. Local `docs/retros/` is no longer used — GitHub is the sole retro
archive.

> **Persona**: `product` · **Model Tier**: `high` (deep-reasoning) **Skills**:
> `core/documentation-and-adrs`, `core/idea-refinement`

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
4. **Fetch the code-review structured comment** (if present) from the Epic —
   `provider.getTicketComments(epicId)` filtered by the
   `ap:structured-comment type="code-review"` HTML marker (posted by
   `sprint-code-review.js`). Summarise any Critical Blocker / High Risk findings
   in the **Architectural Debt** section of the retro body below. If no comment
   is present, note "no automated code-review findings".
5. **Fetch the parked-follow-ons structured comment** (if present) from the Epic
   — filter by `ap:structured-comment type="parked-follow-ons"` (posted by the
   dispatcher). The JSON block lists **recuts** (Stories created mid-sprint
   carrying a `<!-- recut-of: #N -->` marker attributable to a manifest Story)
   and **parked** follow-ons (Stories without manifest lineage). Attribute
   recuts back to their parent Story in the scorecard so the sprint count lines
   up with the frozen manifest, and call out any parked follow-ons in **Action
   Items for Next Epic**. Each Story also declares its recut lineage directly in
   its body via the `<!-- recut-of: #N -->` marker — read that as a fallback
   when the structured comment is absent.

## Step 2 — Compose the Retrospective Markdown

Produce the retro body (in memory — do **not** write to disk) with this
structure. The body **must end** with an HTML marker comment of the form
`<!-- retro-complete: <ISO_TIMESTAMP> -->` — that marker is the detection signal
used by `/sprint-close`'s Retrospective Gate (Step 1.5) when a
structured-comment lookup is unavailable.

### Checkpoint after each composed section (`retro-partial`)

Long retros can run for many minutes and occasionally crash mid-compose. To
avoid re-composing from scratch, **upsert** a `retro-partial` structured
comment on the Epic **after composing each major section**. The retro body
assembled so far is the comment body; each checkpoint replaces the prior
`retro-partial` (one comment per Epic, never N).

Call order (one upsert per checkpoint):

```text
compose Sprint Scorecard                    → upsertStructuredComment(epicId, { type: 'retro-partial', body })
compose What Went Well                      → upsertStructuredComment(epicId, { type: 'retro-partial', body })
compose What Could Be Improved              → upsertStructuredComment(epicId, { type: 'retro-partial', body })
compose Architectural Debt                  → upsertStructuredComment(epicId, { type: 'retro-partial', body })
compose Protocol Optimization Recommendations → upsertStructuredComment(epicId, { type: 'retro-partial', body })
compose Action Items for Next Epic          → upsertStructuredComment(epicId, { type: 'retro-partial', body })
```

`upsertStructuredComment` lives in
`.agents/scripts/lib/orchestration/ticketing.js` and replaces the prior
comment of the same type on each call, so no comment sprawl occurs. The
partial body does **not** carry the `retro-complete:` marker — it is
informational only. Step 3 then posts the final body as `type: 'retro'`
with the `retro-complete:` marker, which `/sprint-close` Phase 5.1 uses as
its sole completion gate (the regex matches `retro-complete:` exclusively,
so `retro-partial:` checkpoints never trip the gate).

If this helper is re-invoked after a mid-run crash, the prior
`retro-partial` comment is visible on the Epic; resume composition from the
next unwritten section rather than starting over.

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

<!-- retro-complete: 2026-04-15T00:00:00Z -->
```

Replace the placeholder ISO timestamp with the actual time the retro was
composed. The marker MUST be present as the final line so downstream gates can
detect completion even when the structured-comment type metadata is not
available to the caller.

The `## 🪞 Sprint Retrospective — Epic #[EPIC_ID]` heading should appear at the
top for human readability, but `/sprint-close`'s Retrospective Gate no longer
depends on a heading grep — it prefers `provider.getComments(epicId)` filtered
by `type === "retro"` and falls back to grepping for the `retro-complete:` HTML
marker added at the end of the body.

## Step 3 — Post the Retrospective as an Epic Comment

Post the composed markdown as a structured comment on the Epic issue, tagged
with the `retro` type. **Never** route the retro body through `notify.js` —
that path fires the notification webhook, leaking the long-form retro body to
downstream consumers (Make.com / Slack / Discord). GitHub is the sole
destination.

```text
# Preferred — MCP-native structured comment (does NOT fire the webhook):
mcp__agent-protocols__post_structured_comment \
  --ticket [EPIC_ID] --type retro --body "<retro markdown>"

# Direct SDK fallback (also does NOT fire the webhook):
node -e "
  import('./.agents/scripts/lib/provider-factory.js').then(async ({ loadProvider }) => {
    const provider = loadProvider();
    await provider.postComment([EPIC_ID], { body: '<retro markdown>', type: 'retro' });
  });
"
```

The retro body **must** still end with the `<!-- retro-complete: <ISO_TIMESTAMP> -->`
HTML marker — `/sprint-close`'s Retrospective Gate (Phase 5.1) falls back to
grepping that marker when the structured-comment type lookup is unavailable.
This final `retro` comment replaces any prior `retro-partial` checkpoint
posted during Step 2.

Record the returned comment URL — the caller (typically `/sprint-close`) may
echo it in its summary.

### Manual verification

After a full retro run, inspect the Make.com (or equivalent)
notification webhook log for the window of the run and confirm **no entry
contains the retro body**. The webhook should only ever see short
notification payloads fired elsewhere in the protocol — the retro post must
not appear there. If it does, Step 3 has regressed to a `notify.js` path;
stop and fix before continuing.

### Fallback on network failure

If the comment post fails (network / 4xx / 5xx), **do not** write the retro to
disk. Surface the error to the operator and abort. The retro body lives only in
the agent's working memory for the current session — the operator re-runs
`/sprint-close [EPIC_ID]` after resolving connectivity (which will re-invoke
this helper) so the content is regenerated from the ticket graph (the
authoritative source) and posted fresh.
The `retro-partial` checkpoint from Step 2 remains on the Epic so prior
section composition is preserved across the re-run. GitHub is the sole retro
archive.

## Step 4 — Update Architecture & Patterns Documentation (Optional)

If the Epic introduced cross-cutting architectural decisions, update the
supporting docs in the same session:

- Update `docs/architecture.md` if any core schemas or dependencies were
  introduced during this Epic.
- Update `docs/decisions.md` to capture key architectural decisions made during
  implementation.

Commit these with a conventional `docs(...)` message on the Epic branch. Do
**not** stage or commit the retro itself — it lives only on GitHub.

## Constraint

- **Never** write the retro to `docs/retros/` or any other local path as the
  permanent artifact. GitHub Epic comments are the source of truth.
- **Never** omit the closing `<!-- retro-complete: <ISO_TIMESTAMP> -->` marker —
  `/sprint-close`'s Retrospective Gate falls back to grepping for it when the
  structured-comment lookup is unavailable.
- **Never** post the retro body through `notify.js`. That path fires the
  notification webhook and leaks the long-form retro to Make.com / Slack /
  Discord. Use `mcp__agent-protocols__post_structured_comment` (preferred) or
  `provider.postComment(..., { type: 'retro' })` exclusively — both post only
  to GitHub and never touch the webhook.
- **Always** post the retro as `type: retro` via the structured comment API so
  downstream tooling (and the `/sprint-close` gate) can filter it.
- **Always** re-run the workflow end-to-end if the final comment post fails.
  The `retro-partial` checkpoint written in Step 2 preserves section-level
  progress across the re-run — resume composition from the next unwritten
  section rather than starting over.
- GitHub is the Single Source of Truth in v5 — all execution data must be
  sourced from the ticket graph.
