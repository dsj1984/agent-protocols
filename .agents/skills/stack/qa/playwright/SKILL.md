---
name: playwright
description:
  Robust E2E browser testing with Playwright. Use when writing browser-driven
  tests — leverage auto-waiting (no `waitForTimeout`), prefer user-visible
  locators (`getByRole`, `getByText`, `getByLabel`) over CSS/XPath, reuse
  `storageState` for auth, and enable trace-on-first-retry for CI debugging.
vendor: playwright
---

# Skill: Playwright

## Policy Capsule

- Rely on Playwright's auto-waiting; never use `waitForTimeout` or hardcoded sleeps to paper over flakes.
- Prefer user-visible locators (`getByRole`, `getByText`, `getByLabel`) over CSS selectors or XPath.
- Reuse `storageState` to seed authenticated scenarios; do not repeat login flows in every test.
- Use `toHaveScreenshot()` for critical visual surfaces; treat snapshot diffs as intentional reviews, not auto-refreshes.
- Write tests independent of one another so they run in parallel; clean up shared state in fixtures, not afterwards.
- Enable `trace: 'on-first-retry'` (or `'retain-on-failure'`) so CI failures are debuggable in the Trace Viewer.
- Use a unique data set per test run, or tear down state explicitly, to prevent cross-test contamination.
- Never let Playwright own the lifetime of a dev server it did not start: boot the server out-of-band, point the suite at the running origin, and set `reuseExistingServer` so `webServer` only probes readiness.

## Running a `webServer`-backed suite outside CI

Playwright's `webServer` block **watches the process it spawned**. That
assumption holds for a dev server that stays in the foreground, and breaks for
any manager that daemonizes one — the foreground process exits `0` while the
server keeps serving, Playwright reads the exit as a crash, and the run aborts
before a single test executes:

```text
Process from config.webServer exited early
```

Read that line as a **lifetime-ownership mismatch, not a flake**. It reproduces
on every invocation, clean tree or not, and no amount of retrying, tree-cleaning
or timeout-raising changes it. Agent sandboxes and IDE harnesses commonly manage
dev servers this way (`Dev server already running at … (pid N)`), so an agent
meets this far more often than a developer does.

### Attach, don't boot

Invert the ownership instead of fighting it — the manager owns the process,
Playwright owns only the probe:

1. **Boot the server out-of-band** through whatever manages it, and confirm it
   is serving. Its lifetime is now the manager's concern, not the runner's.
2. **Point the suite at the already-running origin** — set the config's
   `baseURL` (or the `webServer.url` the block probes) to that origin, via the
   project's own environment seam rather than an edit to committed config.
3. **Set `reuseExistingServer: true`** so Playwright probes the URL, finds it
   live, and never spawns or supervises a process of its own.

This is the same convention the QA harness already encodes as
`qa.environments[].baseUrl`: attach to a running origin, never boot one. A suite
run this way exercises identical browser behavior — only the process supervision
differs.

### When no attachable origin exists

Some apps genuinely cannot be reached this way — the server is unreachable from
the sandbox, or the suite depends on a build step the sandbox cannot run. Do
**not** burn a timebox rediscovering that. Record the observed signature, state
which of the three steps above failed, and escalate on the first encounter:
that evidence is exactly what the `unreproducible-tier` verdict in
[`ci-remediation.md`](../../../../rules/ci-remediation.md) requires, and it is
the only verdict that lets an unrunnable tier route somewhere other than a dead
end.
