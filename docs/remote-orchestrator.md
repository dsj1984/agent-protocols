# Remote Orchestrator

The remote orchestrator drives an Epic end-to-end without an operator in
the loop. It is invoked by a GitHub Actions trigger when an Epic issue is
labelled `agent::dispatching`, but the same engine is used for local
invocations of `/sprint-execute-epic`.

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
    • claude /sprint-execute-epic <epicId>
        │
        ▼
EpicRunner coordinator (.agents/scripts/lib/orchestration/epic-runner.js)
    • flip Epic to agent::executing
    • initialize / resume the epic-run-state checkpoint comment
    • for each wave N:
        • fan out up to concurrencyCap /sprint-execute-story sub-agents
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
`/sprint-execute-story`; replace it inside a Claude skill context with a
real Agent-tool invocation.
