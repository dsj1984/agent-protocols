---
description: >-
  DEPRECATED alias for /sprint-execute-story. Kept so in-flight scripts,
  dashboards, and muscle-memory invocations still resolve.
---

# /sprint-execute (deprecated)

> ⚠️ **Deprecated** — use [`/sprint-execute-story`](sprint-execute-story.md) for
> executing a single Story, or [`/sprint-execute-epic`](sprint-execute-epic.md)
> for the full Epic orchestration flow.
>
> `/sprint-execute <Story ID>` still behaves identically to
> `/sprint-execute-story <Story ID>` for now, but the alias will be removed in
> a future release.

## Delegation

When invoked, treat this skill as a thin alias: print the deprecation notice
above once, then hand off to `/sprint-execute-story` with the same arguments.
All canonical instructions live in
[`sprint-execute-story.md`](sprint-execute-story.md) — do not duplicate them
here.

## Constraint

- **Do not** add new Story-execution logic to this file — it is frozen as an
  alias.
- **Always** delegate to `/sprint-execute-story` with the same arguments.
- **Remove** this stub once telemetry confirms no callers reference the old
  `/sprint-execute` name.
