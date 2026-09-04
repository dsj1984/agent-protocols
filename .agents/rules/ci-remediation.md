# CI Failure Triage & Remediation

This rule applies when a delivery path is watching a pull request's CI checks
and a required check is red (or repeatedly slow). The Story Step 4 CI watch +
fix loop ([`deliver-story.md`](../workflows/helpers/deliver-story.md)) hands off
to it: the watcher (`pr-watch-with-update.js`) surfaces the failing check, the
run link, and the failure signature; this rule decides what to do next.

## Goal

**A red check is a defect until proven otherwise, and the fix is always to
remove the defect — never to hide it.** A red required check is resolved in
exactly one of two ways, and no others:

1. **Remove the root cause on the branch.** Pull the failing job log and record
   the failure signature (failing check, run id / run link, first distinctive
   error line — the watcher writes this to
   `temp/story-<id>-ci-digest.{json,md}`). Reproduce the failure, confirm it is
   caused by the diff under review — **verify the same check against an
   unmodified `main` checkout**; if it also fails on `main` the defect is
   pre-existing and belongs in a separate change — then fix it at source,
   commit on `story-<storyId>`, push, and re-run the watcher. Auto-merge is
   **disarmed on the first red** and re-armed only by a green on a **new head
   SHA**, so the fix must be a new commit. Route deterministic per-check
   failures (lint/format,
   maintainability/CRAP baseline drift, test failure, coverage threshold)
   through the fix table in
   [`deliver-story-reference.md` § Step 4](../workflows/helpers/deliver-story-reference.md#step-4--ci-watch--fix-recovery);
   refresh a baseline only when the diff demonstrably can't be covered.
2. **File a `meta::framework-gap` issue** when the root cause is outside this
   delivery's scope — a pre-existing flaky test, a runner/infra weakness, a
   framework-level environment gap. Open the issue with the `meta::framework-gap`
   label (see [`git-conventions.md`](git-conventions.md)) carrying **the run
   link and the failure signature** so a later `/mandrel-plan` Phase 0 sweep can act on
   it. Remediate this delivery only if the pre-existing defect is genuinely
   blocking it.

Infra, transient, and flaky failures are root-cause defects too — a flaky test
that passes on a rerun is still a bug that will fail a future run. They route
through the same two options; bisect environment (runner OS, Node version,
concurrency, a platform-conditional branch, an external service) vs. code (an
order-dependent test, a race, a shared-state assumption) to decide which.

## Verdicts

Every red check reaches exactly one verdict, and each verdict routes to one of
the two options above. Name the verdict you reached in the `friction` comment.

| Verdict | Evidence | Routes to |
| --- | --- | --- |
| **defect-in-diff** | The failure reproduces on the branch and not on an unmodified `main` | Option 1 — fix at source |
| **pre-existing** | The same check fails on an unmodified `main` too | Option 2 — file `meta::framework-gap`; remediate here only if it blocks this delivery |
| **capacity** | Proven exhaustion of a runner resource, not a property of the diff (see below) | Option 2 — file `meta::framework-gap` **and** escalate to the operator |
| **unreproducible-tier** | The tier cannot be exercised in this sandbox at all, proven by an attempted attach (see below) | Option 2 — file `meta::framework-gap` **and** escalate on first encounter |

### The `capacity` verdict

A job can fail because the runner ran out of something, not because the code is
wrong: no runner could be provisioned, the disk or memory ceiling was hit, a
process/PTY/file-descriptor limit was exhausted, the job wall-clock timed out
with no progress, or a self-hosted pool was saturated. Nothing on the branch
causes it and nothing on the branch can fix it.

This verdict exists because the rule previously offered no landing for that
case. The honest reading of "a red check is a defect until proven otherwise" is
that capacity failures are the *otherwise* — but with no verdict for them the
only shapes on offer were "fix the diff" (impossible) and "it's flaky, re-run
it" (forbidden), so the rule got broken rather than followed. Naming the verdict
removes the incentive to launder a capacity failure as a rerun.

**Capacity must be proven, not inferred.** A green on re-run is the single
weakest form of evidence for it and never establishes it — that is precisely the
observation a flaky test produces. Cite the resource and the reading: the log
line naming the exhausted limit (an OOM kill, `ENOSPC`, `EMFILE`,
`forkpty/sudo: Device not configured`, a provisioning error, a no-output
timeout), plus the fact that the failure is not specific to this diff. Absent
that reading the verdict is **flaky, not capacity**, and it routes to Option 1.

On a `capacity` verdict: file the `meta::framework-gap` issue with the run link,
the failure signature, and the resource reading; flip the Story to
`agent::blocked` with a `friction` comment naming the verdict; and hand back to
the operator, who owns the runner pool. Do not sit in a retry loop waiting for
capacity to return.

**Rerunning a failed job to reach green stays forbidden under every verdict,
`capacity` and `unreproducible-tier` included.** The verdict changes who owns the fix and where it is
filed; it never licenses a re-run, and it is not a route to a green bar. A
capacity-blocked delivery ends `agent::blocked` — not merged.

### The `unreproducible-tier` verdict

A check can fail on a tier the sandbox cannot run at all — most often a
browser suite whose Playwright `webServer` block supervises a dev server the
local process manager daemonizes, which aborts the run with
`Process from config.webServer exited early` before any test executes. The
failure is a property of the sandbox's ability to *host* the suite, not of the
diff.

This is the same structural hole the `capacity` verdict was added to fill, one
step earlier in the loop. Without it the honest reading is `flaky`, which routes
to Option 1 — and fix-at-source requires reproducing the failure, which is the
one thing that cannot be done. The agent then spends the full timebox
rediscovering that before escalating anyway, and any fix it does author is
written blind against a tier it never ran.

**Unreproducible must be proven, not inferred.** "The suite did not run for me"
is not the verdict — it is the symptom every misconfiguration produces. Cite
both:

- **The attempted attach.** Work the attach-don't-boot seam in the
  [`playwright`](../skills/stack/qa/playwright/SKILL.md) skill — boot the server
  out-of-band, point the suite at the running origin, set `reuseExistingServer`
  — and name which step failed and how. A tier that runs once attached was never
  unreproducible.
- **The observed signature.** The verbatim line the runner aborted on, so a
  later reader can tell a lifetime-ownership mismatch from a genuine boot
  failure in the app under test.

Absent both readings the verdict is unavailable and the failure routes as it did
before. On the verdict: file the `meta::framework-gap` issue with the run link,
the failure signature, and the attach attempt; flip the Story to
`agent::blocked` with a `friction` comment naming the verdict; and hand back to
the operator, who owns the sandbox. Do not author a fix for a tier you could not
run — a blind fix to a suite nobody exercised is how the gap compounds.

## Verifier

The check is resolved only when it is **green with zero reruns of the failed
job**, and the diff carries **no `.skip` / `.only`, no quarantine, and no
deleted or loosened assertion** introduced to reach green. You may **not**
re-run a failed job to "see if it goes green," and you may **not** skip,
`.only`, or quarantine a flaky test to get a green bar. Both mask the defect
and are prohibited by this rule.

**The enforcement point is
[`pr-watch-with-update.js`](../scripts/pr-watch-with-update.js)**, and it acts
on the **first red** — GitHub's native auto-merge fires server-side, so it
races any attempt to detect a rerun-green and block it after the fact. On the
first red the watcher **disarms native auto-merge** (a disarm failure is a
blocker, not a warning) and records the PR **head SHA** in the digest
alongside the failing check-run identity. On green it adjudicates:

- **Same head SHA** → the green came from re-running the failed job. The
  watcher exits non-zero, flips the Story to `agent::blocked` with a
  `friction` comment, and requires the `meta::framework-gap` issue (run link +
  failure signature, both already in the digest) before the delivery proceeds.
- **New head SHA** → fix at source. The digest is retired, auto-merge is
  re-armed, and the delivery continues unobstructed.

A delivery that never went red has no digest and is untouched.

## Escalation

Flip the ticket to `agent::blocked`, post a `friction` comment (naming the
failing check, the run link, the failure signature, the classification you
reached, and what you tried — **never fall silent**), and hand back to the
operator under **any** of:

- **Three strikes.** Three consecutive remediation iterations on the same
  failure class without convergence — the diagnosis is likely wrong (see
  [`instructions.md` § 1.I Anti-Thrashing](../instructions.md)).
- **Wall-clock timebox.** More than **30 minutes** of active remediation on a
  single CI failure without a green bar in sight.
- **Clearly-environmental → escalate immediately.** An unambiguously
  environmental failure outside your control (runner provisioning, a persistent
  registry/network outage, a branch-protection or CI misconfiguration, an
  expired credential) — file the `meta::framework-gap` issue (with run link +
  signature) and escalate on the first encounter rather than burning iterations
  trying to code around it. A proven-capacity failure is this case: reach the
  `capacity` verdict above and escalate on the first encounter.
- **Unrunnable tier → escalate immediately.** A tier the sandbox cannot host at
  all is this case too: work the attach seam once, reach the
  `unreproducible-tier` verdict above with its two readings, and escalate on the
  **first encounter**. The 30-minute timebox is a ceiling here, never a budget
  to spend — every minute past the failed attach buys nothing, because no
  iteration can make an unhostable suite run.
