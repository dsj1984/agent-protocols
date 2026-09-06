# Browser Testing with DevTools — Reference (on-demand)

**Read this when** a task engages one of the sections below and the Policy
Capsule in [`SKILL.md`](SKILL.md) does not settle it on its own. The capsule
is the contract; this file is the reference material behind it. The
untrusted-content and JS-execution constraints live in the capsule and the
security baseline it cites; generic DevTools tool tables and symptom-by-symptom
workflow ladders are omitted as frontier-known.

## Setting Up Chrome DevTools MCP

Add the Chrome DevTools MCP server to your project's `.mcp.json` (or Claude
Code settings):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    }
  }
}
```

This gives the agent screenshot capture, DOM inspection, console logs, a
network monitor, performance traces, computed styles, the accessibility tree,
and read-only JavaScript execution — the runtime evidence that static code
analysis cannot provide.

## The clean-console standard

A production-quality page has **zero** console errors and warnings. If the
console is not clean after a browser-touching change, fix the warnings before
shipping — warnings become errors, and a clean console catches bugs early.
