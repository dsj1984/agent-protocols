---
description: >-
  Orchestrate end-to-end Epic execution via wave-based story fan-out, GitHub
  label/state checkpointing, and — when opted-in via `epic::auto-close` — the
  full bookend chain (code-review → retro → close).
---

# /sprint-execute-epic #[Epic ID]

## Overview

`/sprint-execute-epic` is the **long-running orchestrator** that composes
`/sprint-execute-story` sub-agents across every wave of an Epic. Unlike
`/sprint-execute-story`, which is a single-shot worker, this skill is the
entry point for the remote-agent dispatch flow (fired from
`.github/workflows/epic-dispatch.yml`) and can also be invoked locally for
manual end-to-end runs.

> **Status**: scaffold. The engine lives in `lib/orchestration/epic-runner.js`
> (added in a follow-up Story). Until that lands, this workflow document
> captures the intended contract; the CLI at `.agents/scripts/epic-runner.js`
> is a thin wrapper that will start the run once the engine is available.

---

## Contract

- **Argument**: a single **Epic ID** (`type::epic`). Story IDs are rejected.
- **Idempotent by checkpoint**: resumes from the `epic-run-state` structured
  comment if present; otherwise initializes a fresh run.
- **Single pause point**: only `agent::blocked` halts execution. All other
  labels are informational during the run.
- **Snapshot modifier**: `epic::auto-close` is read once at run start. Adding
  it mid-run is ignored; removing it mid-run is ignored.

## Invocation

```bash
node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]
```

The skill drives that CLI. Inside the remote-agent environment, it is invoked
indirectly by `.agents/scripts/remote-bootstrap.js` after the workspace is
provisioned.

## Flow (summary — see tech spec #323 for the full diagram)

1. **Startup**: flip Epic to `agent::executing`, snapshot `autoClose`, write
   initial `epic-run-state` checkpoint comment.
2. **Per wave**: compute wave N via `Graph.computeWaves()`, launch up to
   `orchestration.epicRunner.concurrencyCap` parallel `/sprint-execute-story`
   sub-agents, poll every `pollIntervalSec`, write wave-end comment, advance.
3. **Blocker**: flip Epic to `agent::blocked`, post friction comment, fire
   webhook, park until the operator flips back to `agent::executing`.
4. **Final wave completes**: flip Epic to `agent::review`.
5. **If `autoClose` was set**: chain `/sprint-code-review` →
   `/sprint-retro` → `/sprint-close`. Otherwise exit cleanly for the operator
   to drive the bookends manually.

## Constraint

- **Never** honor a mid-run change to `epic::auto-close`. The snapshot at
  startup is authoritative.
- **Always** checkpoint via `post_structured_comment` with the
  `epic-run-state` marker — never write run state anywhere else.
- **Always** retire `risk::high` runtime gating for this flow. The label
  remains queryable in retro metrics but does not pause execution.
- **Never** launch more than `concurrencyCap` parallel story executors per
  wave.

---

> 📎 See tech spec **#323** for the full component diagram, failure model,
> `epic-run-state` schema, and `.agentrc.json` keys under
> `orchestration.epicRunner`.
