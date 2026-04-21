# MCP Setup

This repo ships a project-scoped MCP server, `agent-protocols`, backed by
[`.agents/scripts/mcp-orchestration.js`](../.agents/scripts/mcp-orchestration.js).
Local Claude Code discovers it via `.mcp.json` at the repo root. That file is
`.gitignore`d (it holds operator secrets) so each checkout must be provisioned
once, and every worktree inherits a copy through
[`bootstrapper.js`](../.agents/scripts/lib/worktree/bootstrapper.js).

This doc pins the portable convention for the `agent-protocols` server entry so
the same `.mcp.json` works across machines, operators, and worktree paths.

## Convention — relative path (Option A, preferred)

The `command`/`args` pair for the `agent-protocols` entry must resolve the
server script by **relative path from the project root**, not an absolute path:

```jsonc
{
  "mcpServers": {
    "agent-protocols": {
      "command": "node",
      "args": [".agents/scripts/mcp-orchestration.js"],
      "env": {
        "GITHUB_TOKEN": "…",
        "NOTIFICATION_WEBHOOK_URL": "…"
      }
    }
  }
}
```

Why relative works: Claude Code launches project-scoped MCP servers with the
project directory as the process `cwd`. Node resolves the relative path against
that `cwd`, which is the repo root in the main checkout and the worktree root
in `.worktrees/story-<id>/`. No per-machine editing is required.

### Why not the absolute path

An absolute path like `C:/Users/alice/Projects/agent-protocols/.agents/...`
only works on that one operator's machine and breaks immediately in:

- a second operator's clone (different user directory),
- a per-story git worktree at `.worktrees/story-<id>/` (different root),
- the remote-agent runner described in [Epic #321 Tech Spec](#) (clones into a
  fresh path).

Relative paths solve all three cases with one file.

## Fallback — `${CLAUDE_PROJECT_DIR}` expansion (Option B)

If a harness or tool in the future runs the MCP entry from a `cwd` other than
the project root, swap to the env-var form Claude Code expands at launch:

```jsonc
"args": ["${CLAUDE_PROJECT_DIR}/.agents/scripts/mcp-orchestration.js"]
```

`CLAUDE_PROJECT_DIR` is set by Claude Code to the absolute path of the project
root. Only reach for this form if the relative path stops resolving — it adds a
hidden dependency on that variable being populated.

## Last resort — `package.json` bin + `npx` (Option C)

If neither of the above is viable (e.g. a sandbox strips env vars and runs from
an arbitrary `cwd`), register a bin entry in `package.json` and invoke via
`npx`. Not used today; documented for completeness.

## Verifying locally

After editing `.mcp.json`:

1. Restart Claude Code (MCP servers are loaded at session start, not hot-reloaded).
2. In a fresh session, confirm the `agent-protocols` tools appear
   (e.g. `mcp__agent-protocols__hydrate_context`).
3. If they don't, open the MCP server log from Claude Code's status panel and
   look for `ENOENT` on the script path — that's the tell for a wrong relative
   path or unexpected `cwd`.

## Provisioning a fresh checkout

1. Copy `.mcp.json` from your existing working machine (or from the operator
   onboarding vault) into the repo root.
2. Confirm the `agent-protocols` entry uses the relative-path form above.
3. Fill in `GITHUB_TOKEN` and `NOTIFICATION_WEBHOOK_URL` under `env`.
4. Restart Claude Code.

Worktrees created by `sprint-story-init.js` pick up `.mcp.json` automatically
through [`bootstrapper.js`](../.agents/scripts/lib/worktree/bootstrapper.js)
(see [`feedback_worktree_untracked_files`](../memory) for the incident that
drove this behavior). You don't need to copy the file by hand into each
`.worktrees/story-<id>/`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `mcp__agent-protocols__*` tools missing after restart | `.mcp.json` not in repo root, or JSON parse error | Verify file exists at `<repo>/.mcp.json` and parses (`node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8'))"`) |
| Server logs `Error: Cannot find module '.agents/scripts/mcp-orchestration.js'` | Claude Code launched the server from a non-project `cwd` | Switch the entry to Option B (`${CLAUDE_PROJECT_DIR}/…`) |
| Tools appear in main checkout but not in a worktree | `.mcp.json` was not copied during worktree bootstrap | Re-run `sprint-story-init.js` for the story, or copy the file manually; file a friction comment so the bootstrapper is audited |
| Permission-prompt loop on first MCP tool use | Expected on a fresh allowlist | Accept the prompts once, or pre-populate `.claude/settings.local.json` via the `fewer-permission-prompts` skill |
| Different absolute path on another machine | Someone edited the entry to absolute before committing secrets | Restore the relative form; `.mcp.json` is gitignored so the fix is local-only |

## Related

- [Tech Spec #323](../.agents/scripts/README.md) — epic-level orchestration; the
  remote-agent runner writes `.mcp.json` from a GitHub secret and expects the
  same relative-path convention.
- [`bootstrapper.js`](../.agents/scripts/lib/worktree/bootstrapper.js) — the
  file-copy path that propagates `.mcp.json` into each worktree.
