---
description: >-
  The deliver path's one bundled framework read. Carries what
  every Story delivery always needs — dispatch decision, engine invariants,
  the change-set/ceremony incantation, the acceptance-eval gate, and the
  terminal envelope contract — so the engine reads one file instead of
  re-reading the helper/schema set each session.
---

# Deliver digest (read once per session)

> **Bundle, not a procedure.** [`deliver-story.md`](deliver-story.md) is still
> the steps. This file is the material those steps referenced across five
> separate files and a JSON schema — bundled so one read covers the whole happy
> path. Situational material (lease preflight, recovery routers, merge-wait
> budgets, CI remediation) stays on demand in
> [`deliver-story-reference.md`](deliver-story-reference.md) and
> [`deliver-reference.md`](deliver-reference.md); read those **only** when an
> envelope or a failure routes you there.

## 1. Dispatch — where the engine runs

Read `stories[].dispatchMode` from the `resolve-stories.js` envelope.
`inline` names one indivisible resource — **the router's own session** — so one
rule produces it:

1. **Run topology.** A run resolving **one** Story is `inline`
   whatever its shape — sub-agent isolation is load-bearing only against a
   *concurrent* sibling racing the same checkout, and a one-Story run has none.
2. **Every other run is `subagent`.** A multi-Story run dispatches every Story
   as a sub-agent however trivial its shape: a lite body does not conjure a
   second session for a sibling to run in, and the wave tick may hand you the
   whole set on one beat. Shape still sets ceremony and is reported alongside;
   the `route::lite` label is a human-visible hint, never the control signal.

`inline` removes model-side fan-out only — no `story-worker` boot, no fresh
acceptance-critic spawn. **`subagent` and `inline` run the same engine**: same
gates, same PR to `main`, same terminal envelope, byte for byte.

## 2. Engine invariants

| Trait | Contract |
| --- | --- |
| Ticket type | `type::story` only; an `Epic: #N` footer means **stop and re-plan** |
| Branch | `story-<id>`, seeded from `project.baseBranch` (`main`) |
| Merge target | `main` via PR (squash + required checks) — never a direct push |
| Gates | Every close gate runs regardless of route; no route bypasses one |
| State | Only via `update-ticket-state.js --ticket <id> --state <state>` |
| Paths | Prefix every path-based tool with the absolute `workCwd` — `cd` does not scope them |

**Land or block.** Worktree → `story-<id>` → close-validation → PR to `main` is
the only sanctioned landing. A silent local build is not a delivery.

## 3. Change set — computed once, handed to everyone

One enumeration per Story. A critic that re-runs its own `git diff`
can score a different set than the one that routed it:

```bash
node --input-type=module -e '
  import { computeChangeSet } from "<main-repo>/.agents/scripts/lib/orchestration/change-set.js";
  const { files } = computeChangeSet({ baseRef: "main", headRef: "story-<storyId>" });
  console.log(JSON.stringify(files));
'
```

Derive the level with `deriveChangeLevel`
([`review-depth.js`](../../scripts/lib/orchestration/review-depth.js)) over
that one list: a sensitive path registered in `audit-rules.json` → `high`, none
→ `low`, an unenumerable diff (`files === null`) → `null`. Resolve
fresh-vs-inline critics with `resolveCeremonyForRisk`
([`ceremony-routing.js`](../../scripts/lib/orchestration/ceremony-routing.js)):
`minimal` → always inline, `strict` → always fresh, `standard` → `high`/`null`
→ fresh and `low` → inline unless the `freshCriticSampleRate` floor forces
fresh. An `inline` dispatch mode overrides all of it to inline critics. Close's
`review-depth.js` reads the same derived level, so the two cannot disagree.

## 4. Acceptance self-eval (Step 1a, required)

**One verdict-owner per cluster** — the fresh critic *or* the inline
self-eval, named by `verdictOwner`, never both and never a warm-up pass. It
scores each `acceptance[]` item against the change set above, with `verify[]`
output as evidence. Bounded by `delivery.acceptanceEval.maxRounds` (default 2).
Then score the authored verdict:

```bash
node <main-repo>/.agents/scripts/acceptance-eval.js \
  --story <storyId> --verdict <verdict-path>
```

`proceed` → close. `redraft` → one more round inside the cap. `block` → **do
not close**: post a `friction` comment and flip `agent::blocked`.
Per-round mechanics: [`acceptance-self-eval.md`](acceptance-self-eval.md).

## 5. Terminal envelope — the return contract

`single-story-close.js` emits exactly one envelope on stdout between
`--- STORY DELIVER TERMINAL ---` markers, schema-validated against
[`story-deliver-terminal.schema.json`](../../schemas/story-deliver-terminal.schema.json)
— the SSOT; read the JSON only when you need a field this table omits.
Relay it verbatim; never hand-compose one, never substitute prose.

| `status` | Exit | Meaning | You do |
| --- | --- | --- | --- |
| `landed` | 0 | PR merged, `agent::done`, tail ran (`tail.*: false` degrades the report, not the land) | Relay it. Done. |
| `pending` | 3 | **Resumable, not a failure** — the bounded wait expired healthy, or a human owns the merge. Nothing was mutated. | Run `nextCommand`. |
| `blocked` | 1 | Hard block; `blocked.blockClass` names it | `checks-failed` → fix + resume; else relay |
| `failed` | 1 | A phase crashed; `phase` names which | Diagnose, fix, re-run close |

Required fields: `kind` (`story-deliver-terminal`), `storyId`, `status`,
`phase`, `elapsedSeconds`, `nextCommand`. `phase` is one of `init`,
`wrong-tree-guard`, `close-validation`, `base-sync`, `push`, `pull-request`,
`code-review`, `auto-merge`, `confirm-merge`, `post-land`, `done`. `gates`
reports every gate as `passed` / `failed` / `skipped` — a skipped gate is
reported, never omitted, so a missing gate is never read as a passing one.

**Gate output is captured, not streamed.** Close writes gate lines to
`temp/orchestration/close-gates-<storyId>.log` and reports a one-line digest on
success; a failed gate replays its tail inline. `AGENT_LOG_LEVEL=verbose`
restores live streaming.

## 6. When to leave this file

- Unclear state / a re-run refusal → `deliver-recover.js --story <id>` (read-only).
- Lease, sweep, worktree-scope detail → [`deliver-story-reference.md`](deliver-story-reference.md).
- CI red after the PR opens → [`rules/ci-remediation.md`](../../rules/ci-remediation.md).
- Sequencing, epilogue, checklist threading → [`deliver-reference.md`](deliver-reference.md).
