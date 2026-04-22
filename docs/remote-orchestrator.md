# Remote Orchestrator

The remote orchestrator drives an Epic end-to-end without an operator in
the loop. It is invoked by a GitHub Actions trigger when an Epic issue is
labelled `agent::dispatching`, but the same engine is used for local
invocations of `/sprint-execute <epicId>` (Epic Mode).

## Dispatch flow

```
Operator flips Epic to agent::dispatching
        │
        ▼
.github/workflows/epic-dispatch.yml (issues.labeled)
        │
        ▼ Claude remote agent boots
.agents/scripts/remote-bootstrap.js
    • git clone
    • write .env and .mcp.json from secrets with ::add-mask::
    • npm ci --ignore-scripts
    • claude /sprint-execute <epicId>
        │
        ▼
EpicRunner coordinator (.agents/scripts/lib/orchestration/epic-runner.js)
    • flip Epic to agent::executing
    • initialize / resume the epic-run-state checkpoint comment
    • for each wave N:
        • fan out up to concurrencyCap /sprint-execute <storyId> sub-agents
        • emit wave-N-start / wave-N-end structured comments
        • sync the Projects Status column to reflect progress
    • on blocker → BlockerHandler flips Epic to agent::blocked and waits
    • final wave completes → Epic → agent::review
    • if epic::auto-close was set at dispatch → BookendChainer runs
      /sprint-code-review → /sprint-retro → /sprint-close
```

## Secrets required in the GitHub repo

| Secret             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`| Required by the Claude remote-agent action.                     |
| `ENV_FILE`         | Multi-line contents of the runner's `.env`.                     |
| `MCP_JSON`         | Contents of `.mcp.json` (the portable `agent-protocols` entry). |
| `GITHUB_TOKEN`     | Provided automatically by Actions; used for clone + API calls.  |

`remote-bootstrap.js` emits `::add-mask::` directives for every
secret-derived line before any fs I/O, so accidental echoes in later steps
are redacted in logs. Workspace files are written `0600`.

## Runner requirements

- Node 22+ (matches the CI workflow).
- Outbound HTTPS to the GitHub API and (optionally) to the notification
  webhook sourced from the `agent-protocols` MCP server env
  (`.mcp.json`) or the `NOTIFICATION_WEBHOOK_URL` process env var.
- No inbound connectivity — the orchestrator polls for state and pushes
  webhooks; it does not listen.
- A `claude` CLI available on `PATH`. Override with `CLAUDE_BIN`.

## Authorization model

- **Dispatch** is gated by GitHub's label-write permission. Anyone who can
  add labels to issues can launch an Epic.
- **`epic::auto-close`** is an opt-in modifier that authorizes the
  autonomous bookend chain, including merge-to-main. It is a **snapshot**:
  applying or removing the label mid-run is ignored. Set it once at
  dispatch time to opt in.
- **Branch protection on `main`** (required reviews, no force-push) remains
  the primary safety net for destructive actions — `risk::high` no longer
  halts execution at runtime (see HITL below).

## HITL (Human-in-the-Loop) touchpoints

The orchestrator has **one** runtime pause point:

- **`agent::blocked` on the Epic.** Set by `BlockerHandler` when an
  executor sub-agent escalates an unresolvable failure. The handler posts
  a structured friction comment, fires the notification webhook
  (fire-and-forget), and waits for the operator to flip the Epic back to
  `agent::executing`. In-flight wave-N stories finish naturally; wave N+1
  does not start until resume.

All other labels (`agent::dispatching`, `agent::executing`,
`agent::review`, `agent::done`, `epic::auto-close`, `risk::high`) are
informational during the run — flipping them mid-run does not change
execution behavior.

## Failure and resumption

- **Orchestrator crash mid-wave.** On relaunch, `Checkpointer.read()`
  parses the fenced JSON in the `epic-run-state` comment and resumes from
  `currentWave`. Stories whose branches and/or PRs exist are not
  relaunched; closed stories are treated as complete.
- **Individual story failure.** The executor sub-agent reports `failed`,
  the coordinator escalates to `BlockerHandler`. The `storyRetryCount`
  config controls retries before escalation (default: 1).
- **Cancellation.** Remove `agent::dispatching` — the poller surfaces a
  `cancel-requested` event and the orchestrator halts cleanly, finishing
  in-flight stories and posting a cancellation comment.

## State comment schema

Identified by the marker
`<!-- ap:structured-comment type="epic-run-state" -->`. Body is a fenced
JSON block conforming to the schema in tech spec #323; the authoritative
copy is what the runner last wrote.

## Planning flow

Planning runs as a separate, GitHub-triggered pipeline that is decoupled
from execution. Applying `agent::planning` to a `type::epic` issue fires
`.github/workflows/epic-plan.yml`, which boots a Claude remote agent and
invokes `/sprint-plan-spec`. The agent generates the PRD and Tech Spec as
linked issues (`context::prd`, `context::tech-spec`), flips the Epic to
`agent::review-spec`, and exits. The human reviews the generated documents
on GitHub, then applies `agent::decomposing` to trigger a second remote
invocation that generates the Feature/Story/Task hierarchy and lands the
Epic at `agent::ready`. Flipping to `agent::dispatching` from there
triggers execution (unchanged from v5.14.0).

```
agent::planning  ─► /sprint-plan-spec     ─► agent::review-spec
                                                      │
                                           (human reviews PRD/Spec)
                                                      ▼
agent::decomposing ─► /sprint-plan-decompose ─► agent::ready
                                                      │
                                           (human applies dispatching)
                                                      ▼
agent::dispatching ─► epic-dispatch.yml (unchanged)
```

### Planning labels

| Label                | Role          | Column        | Description                                                                                  |
| -------------------- | ------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `agent::planning`    | Trigger       | Planning      | Fires PRD + Tech Spec generation; flips to `agent::review-spec` on success.                   |
| `agent::review-spec` | Parking state | Spec Review   | PRD + Tech Spec exist; awaiting human review before decomposition.                            |
| `agent::decomposing` | Trigger       | Ready         | Fires Feature/Story/Task generation; flips to `agent::ready` on success.                      |
| `agent::ready`       | Parking state | Ready         | Frozen dispatch manifest exists; awaiting `agent::dispatching`.                               |

`ColumnSync` precedence (terminal states first):
`done > blocked > review > spec-review > ready > planning > in-progress`.

## `epic-plan-state` comment schema

Identified by the marker
`<!-- ap:structured-comment type="epic-plan-state" -->`. Body is a fenced
JSON block. One comment per Epic; the runner upserts it via
`upsertStructuredComment` after every phase transition.

```json
{
  "version": 1,
  "epicId": 349,
  "phase": "review-spec",
  "startedAt": "2026-04-21T20:15:00Z",
  "lastUpdatedAt": "2026-04-21T20:17:42Z",
  "spec": {
    "prdId": 351,
    "techSpecId": 352,
    "completedAt": "2026-04-21T20:17:41Z"
  },
  "decompose": {
    "ticketCount": null,
    "completedAt": null
  },
  "manifestCommentId": null
}
```

**Fields**

| Field                | Type             | Purpose                                                                                              |
| -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `version`            | integer          | Schema version. Bump on breaking changes.                                                            |
| `epicId`             | integer          | The Epic issue number this checkpoint tracks.                                                        |
| `phase`              | string           | One of `planning`, `review-spec`, `decomposing`, `ready`. Reflects the last completed transition.    |
| `startedAt`          | ISO-8601 string  | When the first planning phase began. Preserved across phase transitions.                             |
| `lastUpdatedAt`      | ISO-8601 string  | When the runner last wrote this comment.                                                             |
| `spec.prdId`         | integer \| null  | Issue number of the generated PRD (`context::prd`). `null` until spec phase completes.               |
| `spec.techSpecId`    | integer \| null  | Issue number of the generated Tech Spec (`context::tech-spec`). `null` until spec phase completes.   |
| `spec.completedAt`   | ISO-8601 \| null | When the spec phase finished writing the PRD + Tech Spec.                                            |
| `decompose.ticketCount` | integer \| null | Number of Features + Stories + Tasks created. `null` until decompose phase completes.             |
| `decompose.completedAt` | ISO-8601 \| null | When the decompose phase finished writing the hierarchy.                                         |
| `manifestCommentId`  | integer \| null  | The GitHub comment ID of the frozen dispatch manifest. `null` until decompose phase completes.       |

**Phase invariants**

- `phase: "planning"` — `spec.*` and `decompose.*` all `null`.
- `phase: "review-spec"` — `spec.*` populated; `decompose.*` all `null`.
- `phase: "decomposing"` — `spec.*` populated; `decompose.*` populating.
- `phase: "ready"` — all fields populated; `manifestCommentId` points at the frozen dispatch manifest comment.

**Resumption semantics.** On relaunch, `plan-checkpointer.read()` parses
this comment and decides whether to regenerate the PRD/Spec (skip if
`spec.*` is populated and `--force` was not passed) or to re-decompose
(skip if `decompose.*` is populated and `--force` was not passed).

## `.agentrc.json` keys

```jsonc
{
  "orchestration": {
    "epicRunner": {
      "enabled": true,          // master switch
      "concurrencyCap": 3,      // max parallel stories per wave
      "pollIntervalSec": 30,    // how often to poll GitHub for state
      "storyRetryCount": 1,     // retries before blocker escalation
      "blockerTimeoutHours": 0  // 0 = park indefinitely
    }
  }
}
```

All keys have safe defaults; existing projects continue to work without
touching their config.

## Local invocation

Exactly the same engine drives local runs:

```bash
node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]
```

The CLI loads `.agentrc.json`, instantiates the GitHub provider, and
invokes `runEpic(...)`. The `spawn` adapter is a thin wrapper around
`/sprint-execute` (Story Mode); replace it inside a Claude skill context
with a real Agent-tool invocation.
