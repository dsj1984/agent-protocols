---
description: >-
  Sync the project ROADMAP.md with GitHub Epics (source of truth). One-way sync
  from GitHub to the local file, filling in gaps and updating completion status.
---

# /roadmap-sync

## Overview

This workflow performs a **one-way sync** from GitHub Issues (source of truth)
to the local `ROADMAP.md` file. It queries all Epics in the repository,
determines their completion status, and regenerates the roadmap document. The
sync is additive — it fills in gaps for new Epics and updates status for
existing ones.

> **When to run**: Manually at any time, or automatically as part of
> `/sprint-close` (Step 2.5 — Roadmap Sync). Run it whenever the roadmap drifts
> from the GitHub ticket graph.
>
> **Persona**: `product` · **Skills**: `core/documentation-and-adrs`

## Step 0 — Resolve Configuration

1. Resolve `[ROADMAP_PATH]` from `roadmap.path` in `.agentrc.json` (default:
   `docs/ROADMAP.md`).
2. Resolve `[OWNER]` and `[REPO]` from `orchestration.github` in
   `.agentrc.json`.
3. Resolve `[EXCLUDE_LABELS]` from `roadmap.excludeLabels` in `.agentrc.json`
   (default: `["roadmap-exclude"]`). Epics with any of these labels are omitted
   from the roadmap.

## Step 1 — Fetch All Epics from GitHub

Query the GitHub repository for **all issues** labeled `type::epic`. Include
both open and closed Epics to provide a complete project history.

For **each Epic**, collect:

- **Issue number** (`#N`)
- **Title**
- **State** (`open` or `closed`)
- **Labels** (all labels on the issue)
- **Body** (first paragraph or explicit `## Summary` section for a brief
  description)
- **Child ticket counts**: Query child issues (Features, Stories, Tasks) to
  calculate:
  - Total child count
  - Closed child count
  - Completion percentage: `Math.round((closed / total) * 100)`

Filter out any Epics that carry a label listed in `[EXCLUDE_LABELS]`.

## Step 2 — Classify Epics by Status

Assign each Epic to one of three categories:

| Category       | Criteria                                                 | Emoji |
| -------------- | -------------------------------------------------------- | ----- |
| ✅ Completed   | Issue state is `closed`                                  | ✅    |
| 🚧 In Progress | Issue state is `open` AND at least one child is `closed` | 🚧    |
| 📋 Planned     | Issue state is `open` AND zero children are `closed`     | 📋    |

Within each category, sort Epics by issue number (ascending = oldest first).

## Step 3 — Generate ROADMAP.md

Overwrite `[ROADMAP_PATH]` with the following structure:

```markdown
# Project Roadmap

> **Auto-generated** from GitHub Issues — do not edit manually. Last synced:
> [ISO 8601 datetime]

## 🚧 In Progress

| Epic                                                          | Status         | Progress                |
| ------------------------------------------------------------- | -------------- | ----------------------- |
| [#N — Epic Title](https://github.com/[OWNER]/[REPO]/issues/N) | 🚧 In Progress | `██████░░░░` 60% (6/10) |

## 📋 Planned

| Epic                                                          | Status     | Progress              |
| ------------------------------------------------------------- | ---------- | --------------------- |
| [#N — Epic Title](https://github.com/[OWNER]/[REPO]/issues/N) | 📋 Planned | `░░░░░░░░░░` 0% (0/5) |

## ✅ Completed

| Epic                                                          | Status       | Progress                  |
| ------------------------------------------------------------- | ------------ | ------------------------- |
| [#N — Epic Title](https://github.com/[OWNER]/[REPO]/issues/N) | ✅ Completed | `██████████` 100% (10/10) |
```

### Progress Bar Rendering

Generate a 10-character text progress bar using block characters:

- Filled: `█` (U+2588)
- Empty: `░` (U+2591)
- Scale: `Math.round(percentage / 10)` filled blocks, remainder empty

Example: 73% → `███████░░░`

### Section Rules

- **Omit empty sections** — if there are no Epics in a category, do not render
  the section header or table.
- **In Progress first** — this is the most actionable section and should appear
  at the top.
- **Planned second** — provides forward-looking visibility.
- **Completed last** — historical record.

## Step 4 — Commit

Stage and commit the updated roadmap:

```powershell
git add [ROADMAP_PATH]
git commit --no-verify -m "docs(roadmap): sync ROADMAP.md from GitHub Epics"
```

> **Note:** If running as part of `/sprint-close`, skip committing here — the
> roadmap changes will be included in the sprint-close documentation commit.

## Constraint

- **One-way sync only.** GitHub is the source of truth. Never write back to
  GitHub from this workflow.
- **Never manually edit `ROADMAP.md`** after enabling this workflow — changes
  will be overwritten on next sync.
- **Respect `excludeLabels`.** Epics with any label in the exclude list must not
  appear in the roadmap regardless of their state.
- **Always include the "Last synced" timestamp** at the top of the generated
  file so stakeholders know when the data was last refreshed.
- **Idempotent.** Running this workflow multiple times in succession must
  produce the same output (assuming no GitHub state changes between runs).
