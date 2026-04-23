# agent-protocols MCP Server

> **Consumer reference for the `agent-protocols` MCP server** — the seven tools
> that let an MCP-capable agent drive an Epic end-to-end without spawning shell
> subprocesses. For the human-operator sprint workflow, see
> [`SDLC.md`](SDLC.md).

## Overview

The server lives at [`.agents/scripts/mcp-orchestration.js`](scripts/mcp-orchestration.js)
and is a **thin JSON-RPC 2.0 facade** over the orchestration SDK under
[`.agents/scripts/lib/orchestration/`](scripts/lib/orchestration/). Every tool
delegates into the SDK and ultimately reaches GitHub via the
[`ITicketingProvider`](scripts/lib/ITicketingProvider.js) abstraction.

| Property              | Value                                                            |
| --------------------- | ---------------------------------------------------------------- |
| Entry point           | [`.agents/scripts/mcp-orchestration.js`](scripts/mcp-orchestration.js) |
| Transport             | stdio (newline-delimited JSON-RPC 2.0)                           |
| Protocol version      | `2024-11-05`                                                     |
| Server name           | `agent-protocols`                                                |
| Server version        | Contents of [`.agents/VERSION`](VERSION)                         |
| Tool count            | 7 (no hidden tools; `tools/list` is authoritative)               |
| Permissions           | `Issues: RW`, `Metadata: RO`, `Projects: RW` (if using Projects V2) |

### Transport and stdout guard

The server is **stdio-only** — there is no HTTP listener. It reads one JSON-RPC
request per line on stdin and writes one JSON-RPC response per line on stdout.

A hard `process.stdout.write` redirect at module scope routes **every** non-
protocol write to stderr. `console.log`/`info`/`warn`/`debug`/`error` are
all rebound to stderr with a `[MCP REDIR]` prefix. Only framed
JSON-RPC replies use the real stdout fd via an internal bypass. This
guarantees that a stray `console.log` buried in an SDK code path cannot
corrupt the JSON-RPC stream. If you embed `.agents/scripts/` code in a new
entry point, do **not** assume you can write to stdout directly — the guard
is only installed by `mcp-orchestration.js`.

### Lifecycle

1. Host spawns the server (`node .agents/scripts/mcp-orchestration.js`).
2. Server installs the stdout guard, compiles per-tool AJV validators, and
   registers the seven tools from the SDK-backed registry.
3. Server writes `[MCP] agent-protocols v<VERSION> server started (protocol 2024-11-05)`
   to stderr. If registration fails (missing dep, bad config), the server
   writes the error to stderr and exits `1`.
4. Host issues `initialize` → `notifications/initialized` → optional
   `tools/list` → one or more `tools/call`.
5. Host closes stdin; server exits `0`.

### Version and compatibility policy

- **Patch** (`5.x.Y`) — bug fixes, schema tightening, non-breaking metadata
  additions (`outputSchemaRef`, new optional fields). Tool names, argument
  shapes, and result keys are stable.
- **Minor** (`5.Y.0`) — additive new tools or additive output fields on
  existing tools. Old callers keep working.
- **Major** — reserved for JSON-RPC envelope changes or renamed/removed tools.
  Not expected on the current roadmap.

The MCP server version is sourced from [`.agents/VERSION`](VERSION); it
matches the top-level `package.json` version.

### Input validation (AJV per-tool)

Every tool's `inputSchema` is compiled by AJV at server startup. On
`tools/call`, `params.arguments` is validated **before** the handler runs.
On failure the server replies with JSON-RPC `-32602 Invalid params` and a
`data` payload of the shape:

```jsonc
{
  "tool": "dispatch_wave",
  "errors": [
    { "path": "/epicId", "reason": "must be integer" }
  ]
}
```

Clients should surface `data.errors[].path` + `.reason` directly —
those strings are stable enough for human-facing error UIs.

---

## Tools

Each tool section follows the same layout:

- **Description** — one-line summary.
- **Input schema** — the exact JSON Schema registered with the server.
- **Output shape** — what the `content[0].text` of the reply deserializes to.
- **Side effects** — writes to GitHub, filesystem, etc.
- **Error modes** — the realistic failure set.
- **Example** — minimum valid `tools/call` payload.

All tools accept an optional `githubToken: string` argument. When present it
overrides any ambient token (env var or `gh auth token`) for that single call.
See [Authentication & Configuration](#authentication--configuration) for the
full resolution order.

### `dispatch_wave`

> Dispatch the next ready wave of Tasks for an Epic, or execute Tasks for a
> Story. Ticket type is auto-detected from labels.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "epicId": {
      "type": "integer",
      "minimum": 1,
      "description": "The GitHub issue number of the Epic or Story to process."
    },
    "dryRun": {
      "type": "boolean",
      "description": "If true, compute and return the manifest without transitioning ticket states."
    },
    "githubToken": { "type": "string", "minLength": 1 }
  },
  "required": ["epicId"],
  "additionalProperties": false
}
```

**Output shape**: a [dispatch-manifest](schemas/dispatch-manifest.json)
object (`schemaVersion`, `epicId`, `summary`, `waves`, `storyManifest`,
`dispatched`, `heldForApproval`, …).

**`outputSchemaRef`**: `.agents/schemas/dispatch-manifest.json`.

**Side effects**:

- Transitions dispatched Tasks to `agent::executing` (skipped when `dryRun: true`).
- Persists a full JSON manifest to `temp/dispatch-manifest-<epicId>.json`.
  Persistence failures are logged to stderr but do **not** fail the tool call —
  the in-memory manifest is still returned.
- Posts a `dispatch-manifest` structured comment on the Epic issue when a
  wave is actually dispatched.

**Error modes**:

- `-32602 Invalid params` — `epicId` missing, not an integer, `< 1`, or any
  stray argument key present (`additionalProperties: false`).
- Handler error (returned in `content[0].text` with `isError: true`):
  - `ConflictingTypeLabelsError` — the ticket carries both `type::epic` and
    `type::story` (or any two `type::*` labels).
  - GitHub auth failure (see Authentication).
  - Network / 5xx from the GitHub API.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 1,
  "method": "tools/call",
  "params": { "name": "dispatch_wave", "arguments": { "epicId": 511 } }
}
```

### `hydrate_context`

> Build the full execution prompt for a Task by assembling persona, skills,
> hierarchy context, and the agent-protocol template.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "task": {
      "type": "object",
      "description": "The normalized task object (id, title, body, persona, skills, protocolVersion).",
      "properties": {
        "id": { "type": "integer", "minimum": 1 },
        "title": { "type": "string", "minLength": 1 }
      },
      "required": ["id", "title"]
    },
    "epicBranch": { "type": "string", "minLength": 1 },
    "taskBranch": { "type": "string", "minLength": 1 },
    "epicId": { "type": "integer", "minimum": 1 },
    "githubToken": { "type": "string", "minLength": 1 }
  },
  "required": ["task", "epicId"],
  "additionalProperties": false
}
```

**Output shape**: `{ "prompt": string }` — a self-contained markdown prompt
ready to feed to an executing agent.

**`outputSchemaRef`**: `null` (free-form markdown, no enforced schema).

**Side effects**: none. Read-only against GitHub; no filesystem writes.

**Error modes**:

- `-32602 Invalid params` — `task.id` / `task.title` missing, `epicId` non-
  integer, etc.
- Handler error — Task not found, parent walk fails, GitHub auth failure.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 2,
  "method": "tools/call",
  "params": {
    "name": "hydrate_context",
    "arguments": {
      "task": { "id": 550, "title": "Author .agents/MCP.md end-to-end" },
      "epicId": 511,
      "epicBranch": "epic/511",
      "taskBranch": "story-527"
    }
  }
}
```

### `transition_ticket_state`

> Transition a ticket to a new agent state label. Automatically closes or
> reopens the GitHub issue to match.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "ticketId": { "type": "integer", "minimum": 1 },
    "newState": {
      "type": "string",
      "enum": ["agent::ready", "agent::executing", "agent::review", "agent::done"]
    },
    "githubToken": { "type": "string", "minLength": 1 }
  },
  "required": ["ticketId", "newState"],
  "additionalProperties": false
}
```

**Output shape**: `{ "success": true, "ticketId": number, "newState": string }`.

**`outputSchemaRef`**: `null`.

**Side effects**:

- Adds `newState` label; removes other `agent::*` labels from the ticket.
- Closes the issue when `newState === 'agent::done'`; reopens when
  transitioning **from** `agent::done` to any other state.
- Emits a notifier event (webhook POST when `NOTIFICATION_WEBHOOK_URL` is
  set). The notifier payload carries `{ fromState, toState }`; `fromState`
  may be `null` if the pre-read of the ticket failed transiently — that is
  documented and expected.

**Error modes**:

- `-32602 Invalid params` — `newState` not in the enum (e.g. `status::blocked`
  is **not** valid; use a label edit for that instead), `ticketId` non-integer.
- Handler error — ticket not found, GitHub auth failure, label-api error.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 3,
  "method": "tools/call",
  "params": {
    "name": "transition_ticket_state",
    "arguments": { "ticketId": 550, "newState": "agent::done" }
  }
}
```

### `cascade_completion`

> Recursively propagate ticket completion upward through the hierarchy.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "ticketId": { "type": "integer", "minimum": 1 },
    "githubToken": { "type": "string", "minLength": 1 }
  },
  "required": ["ticketId"],
  "additionalProperties": false
}
```

**Output shape**: `{ "success": true, "ticketId": number }`.

**`outputSchemaRef`**: `null`.

**Side effects**:

- Walks parents upward from `ticketId`. If **all** children of a parent are
  `agent::done`, the parent is transitioned to `agent::done` and the walk
  continues to its parent.
- Propagation **stops** at an Epic (`type::epic`) and at Planning tickets
  (`context::prd`, `context::tech-spec`). Epics close via `/sprint-close`;
  Planning tickets are closed by the operator. Features, by contrast, **do**
  auto-close — they are a hierarchical grouping with no independent branch
  or merge step.
- Emits notifier events for every transitioned parent, same as
  `transition_ticket_state`.

**Error modes**:

- `-32602 Invalid params` — `ticketId` missing / non-integer.
- Handler error — ticket or parent fetch fails; GitHub auth failure.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 4,
  "method": "tools/call",
  "params": { "name": "cascade_completion", "arguments": { "ticketId": 550 } }
}
```

> Note: `transition_ticket_state(..., 'agent::done')` does **not** automatically
> cascade — call `cascade_completion` explicitly after marking a leaf Task
> done. This separation keeps idempotent "just flip the label" calls cheap
> and leaves cascade semantics under the caller's control.

### `post_structured_comment`

> Idempotently upsert a structured comment on a ticket. Existing comments with
> the same type marker are **replaced**, so repeated calls never create
> duplicates.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "ticketId": { "type": "integer", "minimum": 1 },
    "type": {
      "type": "string",
      "oneOf": [
        {
          "enum": [
            "progress", "friction", "notification",
            "code-review", "retro", "retro-partial",
            "epic-run-state", "epic-run-progress", "epic-plan-state",
            "parked-follow-ons", "dispatch-manifest"
          ]
        },
        { "pattern": "^wave-([0-9]{1,3})-(start|end)$" }
      ]
    },
    "payload": { "type": "string", "minLength": 1 },
    "githubToken": { "type": "string", "minLength": 1 }
  },
  "required": ["ticketId", "type", "payload"],
  "additionalProperties": false
}
```

The wave regex intentionally bounds the index to **1–3 digits** (0–999) —
inputs like `wave-1000-start` are rejected so synthetic markers cannot
spoof a real wave comment. The canonical source of the enum and regex is
[`lib/orchestration/ticketing.js`](scripts/lib/orchestration/ticketing.js)
(`STRUCTURED_COMMENT_TYPES`, `WAVE_TYPE_PATTERN`).

**Output shape**: `{ "success": true, "ticketId": number, "type": string }`.

**`outputSchemaRef`**: `null`.

**Side effects**:

- Upserts one comment on the ticket. The comment body is `payload`, prefixed
  with an HTML marker the server uses to find-and-replace on subsequent
  calls with the same `type`. Do **not** include that marker yourself.
- No state label changes. Use `transition_ticket_state` for that.

**Error modes**:

- `-32602 Invalid params` — `type` is not in the enum and does not match the
  wave pattern (common mistake: capital letters, `wave_0_start`, or
  `wave-1000-start`).
- Handler error — ticket not found, GitHub auth failure.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 5,
  "method": "tools/call",
  "params": {
    "name": "post_structured_comment",
    "arguments": {
      "ticketId": 511,
      "type": "progress",
      "payload": "Wave 2 of 4 complete; next wave dispatches in 5m."
    }
  }
}
```

### `select_audits`

> Analyze ticket content and changed files at a given gate; return the set of
> audits that should run.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "ticketId": { "type": "integer", "minimum": 1 },
    "gate": {
      "type": "string",
      "minLength": 1,
      "description": "The current audit gate (e.g. gate1, gate2, gate3, gate4)."
    },
    "baseBranch": {
      "type": "string",
      "minLength": 1,
      "description": "Defaults to \"main\" when omitted."
    },
    "githubToken": { "type": "string", "minLength": 1 }
  },
  "required": ["ticketId", "gate"],
  "additionalProperties": false
}
```

**Output shape**:

```jsonc
{
  "selectedAudits": ["audit-security", "audit-quality"],
  "reasoning": [
    { "audit": "audit-security", "reason": "keyword match: auth" }
  ]
}
```

**`outputSchemaRef`**: `null` (shape is stable but not individually schema'd).

**Side effects**:

- Read-only against GitHub (`getTicket`).
- Shells out to `git diff --name-only <baseBranch>...HEAD` to compute changed
  files for `filePatterns` matching. The spawn is bounded by
  `audits.selectionGitTimeoutMs` (default 30 s); on timeout the tool falls
  back to **keyword-only** matching with a stderr warning and still returns
  a result.

**Error modes**:

- `-32602 Invalid params` — `ticketId` / `gate` missing.
- Handler error — `audit-rules.schema.json` missing or malformed, ticket not
  found.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 6,
  "method": "tools/call",
  "params": {
    "name": "select_audits",
    "arguments": { "ticketId": 511, "gate": "gate3" }
  }
}
```

### `run_audit_suite`

> Execute a list of audit workflows and aggregate their results into the
> standard audit-results JSON shape.

**Input schema**:

```json
{
  "type": "object",
  "properties": {
    "auditWorkflows": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "string", "minLength": 1 },
      "description": "List of audit workflow names (e.g. [\"audit-security\", \"audit-quality\"])."
    }
  },
  "required": ["auditWorkflows"],
  "additionalProperties": false
}
```

**Output shape**: an [audit-results](schemas/audit-results.schema.json)
object — `{ summary: { auditsRun, totalFindings, critical, high, medium, low }, results: [...] }`.

**`outputSchemaRef`**: `.agents/schemas/audit-results.schema.json`.

**Side effects**:

- Loads each `<auditName>.md` workflow from `.agents/workflows/` and returns
  its markdown as a structured `workflow` payload for the calling agent to
  execute.
- No GitHub writes; no ticket state changes.

**Error modes**:

- `-32602 Invalid params` — `auditWorkflows` empty or missing.
- Handler error — `audit-rules.schema.json` missing, workflow file missing
  for a requested name.

**Example**:

```jsonc
{
  "jsonrpc": "2.0", "id": 7,
  "method": "tools/call",
  "params": {
    "name": "run_audit_suite",
    "arguments": { "auditWorkflows": ["audit-security"] }
  }
}
```

---

## Decision Matrix

When you're mid-flow and need to pick a tool, map the intent to the row below:

| Intent                                                                 | Tool                      | Notes                                                    |
| ---------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| "Run the next wave of Tasks for Epic N."                               | `dispatch_wave`           | Auto-detects Epic vs Story from the target's labels.     |
| "Just preview what would dispatch — don't touch GitHub."               | `dispatch_wave` + `dryRun: true` | Persists no manifest, no label transitions.        |
| "Compose the full agent prompt for Task N."                            | `hydrate_context`         | Read-only. Returns markdown.                             |
| "Flip ticket N to executing / review / done."                          | `transition_ticket_state` | Closes/reopens the issue to match.                       |
| "Propagate a just-closed leaf up through its parents."                 | `cascade_completion`      | Stops at Epic + Planning; Features do auto-close.        |
| "Post a progress / friction / retro / wave note to ticket N."          | `post_structured_comment` | Idempotent — replaces existing comment of the same type. |
| "Before running audits, which ones should actually run for ticket N?"  | `select_audits`           | Uses ticket content + changed files against gate rules.  |
| "Execute those selected audits and collect findings."                  | `run_audit_suite`         | Returns workflow payloads for the agent to run.          |

Rules of thumb:

- **Never** write to stdout yourself — always go through a tool. The stdout
  guard exists because one stray write corrupts the stream for the session.
- Prefer `transition_ticket_state` + `cascade_completion` over raw label
  edits. The notifier and close/reopen semantics are in the SDK, not
  GitHub's label API.
- `dispatch_wave` persisting the manifest to `temp/` is a **side effect**,
  not the contract. If you need the manifest programmatically, read the
  tool result — don't tail the file.

---

## Authentication & Configuration

### GitHub token resolution order

The server's `GitHubProvider` resolves credentials in this priority:

| Priority | Source                                                    | Typical environment       |
| -------- | --------------------------------------------------------- | ------------------------- |
| 1        | Per-call `githubToken` argument                           | Short-lived override      |
| 2        | `GITHUB_TOKEN` / `GH_TOKEN` env var                       | CI/CD, background scripts |
| 3        | `gh auth token` (CLI)                                     | Local developer workflow  |
| 4        | Active `github-mcp-server` session                        | Agentic IDE               |

The per-call override never touches process state. It is applied only for
the duration of that single tool invocation.

### Required token permissions

**Fine-grained PATs (recommended):**

- `Issues`: Read & Write
- `Pull requests`: Read & Write
- `Metadata`: Read-only
- `GitHub Projects (V2)`: Read & Write (only if you use the board fields)

**Classic PATs**: `repo` + `project` (full control). Prefer fine-grained when
you can.

### MCP host configuration

Add the following to your MCP host settings (e.g.
`claude_desktop_config.json`, VS Code MCP config, Cursor settings):

```json
{
  "mcpServers": {
    "agent-protocols": {
      "command": "node",
      "args": [
        "/absolute/path/to/your/project/.agents/scripts/mcp-orchestration.js"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_...",
        "NOTIFICATION_WEBHOOK_URL": "https://hooks.example.com/agent-protocols"
      }
    }
  }
}
```

> **Always use absolute paths** in `args`. Relative paths resolve against the
> host process's CWD, which is rarely what you expect when the host is
> launched from a desktop shortcut.

### `NOTIFICATION_WEBHOOK_URL`

Optional. When set, the server POSTs a JSON payload every time a ticket's
label transitions via `transition_ticket_state` or `cascade_completion`. The
payload shape:

```jsonc
{
  "event": "state-transition",
  "ticketId": 550,
  "fromState": "agent::executing",
  "toState":   "agent::done"
}
```

`fromState` may be `null` when the pre-read of the ticket fails transiently
(e.g. rate-limit burst). The transition itself is idempotent and proceeds
regardless.

The URL is **not** stored in `.agentrc.json`. It is sourced from:

1. The `env` block of the `agent-protocols` entry in the MCP host config
   (e.g. `.mcp.json` / `claude_desktop_config.json`); or
2. The `NOTIFICATION_WEBHOOK_URL` process env var (CI secret, project-root
   `.env`).

### Other relevant `.agentrc.json` settings

The server reads the usual `.agentrc.json` at the project root via
[`config-resolver.js`](scripts/lib/config-resolver.js). The MCP-adjacent keys:

| Key                                      | Purpose                                                           | Default       |
| ---------------------------------------- | ----------------------------------------------------------------- | ------------- |
| `orchestration.provider`                 | Ticketing provider name (`"github"`)                              | `"github"`    |
| `orchestration.github.owner`             | Repo owner (required)                                             | —             |
| `orchestration.github.repo`              | Repo name (required)                                              | —             |
| `orchestration.github.projectNumber`     | GitHub Projects V2 number                                         | `null`        |
| `orchestration.github.operatorHandle`    | `@mention` target for notifications                               | —             |
| `orchestration.notifications.mentionOperator` | Whether comments `@mention` the operator                     | `true`        |
| `audits.selectionGitTimeoutMs`           | `select_audits` git-diff spawn timeout, in ms                     | `30000`       |

---

## Troubleshooting

| Symptom                                                             | Likely cause                                                                 | Fix                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Server exits with code `1` before first reply                        | Missing dependency or malformed `.agentrc.json` — see `[MCP]` lines on stderr | Run `npm ci` at the project root; re-validate `.agentrc.json` against `.agents/default-agentrc.json`. |
| `No GITHUB_TOKEN environment variable found.`                        | No token in host env, no `gh` CLI login, no per-call override                  | Set `GITHUB_TOKEN` in the host `env` block, run `gh auth login`, or pass `githubToken` per call.      |
| `-32602 Invalid params` with `/epicId` path                          | Argument was a string (`"511"`) or missing                                    | Send as a JSON number: `"epicId": 511`. Schema uses `coerceTypes: false`.                             |
| `-32602 Invalid params` with `additionalProperties`                  | Stray key (typo) in `arguments`                                              | The per-tool schema is strict — remove or rename the stray key.                                       |
| `Tool not found: <name>`                                             | Mismatched tool name (e.g. `dispatchWave`)                                    | Canonical names are snake_case. Call `tools/list` to enumerate.                                       |
| `ConflictingTypeLabelsError` on `dispatch_wave`                      | Ticket carries more than one `type::*` label                                 | Remove the extra label on the target issue; keep exactly one of `type::epic` / `type::story` / `type::feature` / `type::task`. |
| `post_structured_comment` rejected with `Invalid structured-comment type` | `type` outside the enum and doesn't match `wave-N-start`/`wave-N-end`     | Use one of the documented enums or a wave marker with index 0–999.                                    |
| Host shows garbled text / can't parse replies                        | Something in the SDK wrote directly to the real stdout fd                     | Re-check any custom adapters — use `process.stderr.write` or `Logger`. The guard covers all console APIs by default. |
| `select_audits` returns `selectedAudits: []` for an obvious match    | `git diff` timed out; fell back to keyword-only and the content missed       | Increase `audits.selectionGitTimeoutMs` or narrow the base-branch diff (large repos); check stderr for the timeout warning. |
| `dispatch_wave` succeeds but `temp/dispatch-manifest-<id>.json` is absent | Filesystem write failed (`EACCES`, read-only mount)                      | Check `temp/` write permissions. The tool result is still authoritative — the file is a convenience copy. |

---

## Schemas

The server ships two JSON Schemas that describe structured tool outputs.
They are referenced by the `outputSchemaRef` metadata of each tool so clients
can typecheck replies without introspection:

| Schema                                                             | Referenced by       | Describes                                                         |
| ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------- |
| [`.agents/schemas/dispatch-manifest.json`](schemas/dispatch-manifest.json) | `dispatch_wave`     | Full Epic dispatch plan — waves, story manifest, dispatched tasks, held-for-approval set, summary counters. |
| [`.agents/schemas/audit-results.schema.json`](schemas/audit-results.schema.json) | `run_audit_suite`   | Normalized audit findings — `summary` counters and per-finding `{ auditId, checkId, severity, message, location, recommendation }`. |

Tools with `outputSchemaRef: null` return either a trivial ack
(`{ success: true, ... }`) or a free-form string — no schema to validate
against.

The registry itself (names, input schemas, `outputSchemaRef` pointers) lives
in [`.agents/scripts/lib/mcp/tool-registry.js`](scripts/lib/mcp/tool-registry.js).
`tools/list` surfaces `outputSchemaRef` as tool metadata; consumers that
don't recognize the field should ignore it per standard JSON-RPC forward-
compatibility rules.
