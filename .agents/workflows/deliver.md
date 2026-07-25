---
description:
  Unified delivery entry point. Takes Story ids or a plain-language prompt,
  derives which path the work belongs on, and lands it via the single
  deliver-story engine — story-<id> → PR → main.
---

# /deliver

> **Lean spine.** Happy path + gate list. Sequencing, dispatch mechanics,
> intent phrases, ceremony, and the epilogue live in the on-demand
> [`helpers/deliver-reference.md`](helpers/deliver-reference.md); the unplanned
> path in [`helpers/deliver-light.md`](helpers/deliver-light.md). What every
> delivery always needs is one read:
> [`helpers/deliver-digest.md`](helpers/deliver-digest.md).

## Role

One delivery door. `/deliver` owns input resolution and sequencing only — every
Story lands through [`helpers/deliver-story.md`](helpers/deliver-story.md).

Nothing about the route is declared at the invocation; it is **derived, then
announced, then acted on**. The dependency graph is **discovered, not
declared** — `resolve-stories.js` reads it from live state (body edges ∪ native
`blocked_by` edges, each blocker resolved against its real issue state), so
there is no graph to hand it and no batch label, which is what lets you deliver
Stories **across plan runs and over time**.
`plan-run::<id>` is filter metadata, never a resolution input; `route::lite` is
a body-derived hint only. Ahead of all of it, a **single-Story run runs the
engine inline** whatever the shape — sub-agent isolation only earns its cost
against a concurrent sibling.

## Inputs

Classify what the operator typed **before** doing anything else, and say which
shape you read it as:

| Invocation | Shape | Behavior |
| --- | --- | --- |
| `/deliver` | bare | List the open `agent::ready` Stories and ask which to deliver. Deliver nothing until answered. |
| `/deliver 4712` | ids | One Story via `helpers/deliver-story.md`, **inline in this session** — no `story-worker` spawn. |
| `/deliver 4712 4713 …` | ids | Resolve the set, then sequence by the discovered graph via `stories-wave-tick.js`, dispatching role-scoped sub-agents. |
| `/deliver add a --json flag to doctor` | prompt | Unplanned work: gate, author a receipt Story, land it — [`helpers/deliver-light.md`](helpers/deliver-light.md). |

**The discriminator is lexical and total.** Every positional argument matching
`^#?\d+$` means ids; anything else means a prompt. A **mixed** invocation (ids
*and* prose) is a **hard error** — refuse it and ask which was meant, the way
resolution refuses a whole set rather than under-delivering. A named ticket
that is not `type::story`, or carries an `Epic: #N` footer, is a hard error too.

## Saying what you want

No flags to remember: state intent — *"…but I'll merge it myself"*, *"…take the
lease"*, *"…one at a time"* — and announce what you read before acting.
Phrasings and the flag each fills in:
[`helpers/deliver-reference.md` § Intent phrases](helpers/deliver-reference.md).

`--yes` is **runner-set, never operator-typed**: cron, `/loop`, and headless
dispatch set it to mean *nobody is at the keyboard*, which is what makes the
unplanned path's over-scope stop fail closed to a terminal envelope instead of
a question. Never offer it to an operator or add it to an attended run.

## Procedure

0. **Classify and announce.** Read the invocation per § Inputs and state the
   shape you derived. A prompt leaves for
   [`helpers/deliver-light.md`](helpers/deliver-light.md); bare asks; ids
   continue below.

1. **Resolve the set.** One command, for one Story or many:
   `node .agents/scripts/resolve-stories.js --ids <id,id,...>`. It validates
   the set and shows what will run: read `stories[]`, `dag[]`, and `done[]` to
   present the order in step 2. You do **not** thread them into step 3 — the
   tick re-resolves the graph itself every beat. Resolution hard-errors
   (exit 1) on a named id that is not a Story, carries an `Epic: #N` footer, or
   whose native edges cannot be read — a missing gate would co-dispatch against
   an unlanded blocker.

2. **Confirm (N>1).** Present the order; wait unless `--yes`.

3. **Sequence.** Loop until the tick reports `epilogueDue: true`:

   ```bash
   node .agents/scripts/stories-wave-tick.js \
     --stories <id,id,...> --probe-live \
     --dispatched <every id you have dispatched so far>
   ```

   **Do not add `--concurrency` unless the operator explicitly asked for a
   per-run cap** — an explicit value wins over config, so a filled-in literal
   silently defeats a `.agentrc.local.json` override.

   Each beat re-probes live state to derive done / in-flight itself; you never
   compute them. `--dispatched` is the one thing you must supply — the
   append-only list of every id you spawned this run — and cross-run
   de-confliction via the assignee lease is automatic
   ([`helpers/deliver-reference.md`](helpers/deliver-reference.md) §§ Sequencing
   edge cases, Dispatch mechanics).

   Branch on the exit code:
   - **0** — dispatch each `ready` id (already capped and overlap-free). Empty
     `ready` with work in flight means "waiting"; keep looping.
     `epilogueDue: true` means every Story is done — go to step 4.
   - **2** — `cycleError`: the graph is self-referential. Fix the `depends_on`
     declarations; do not retry.
   - **3** — `wedged`: nothing dispatchable, nothing in flight, undone Stories
     waiting on unmet blockers — both named in the envelope. Land the blocker
     or include it in `--ids`; do not retry unchanged.
   - **4** — `blocked`: a Story carries `agent::blocked`, named in `blocked[]`
     with `blockedReason` — the protocol's HITL pause
     ([`instructions.md` § 1.J](../instructions.md)). **Stop the loop and
     surface it; do not poll.** Read the friction comment
     (`gh issue view <id> --comments`) and resume only once the operator
     unblocks it (`update-ticket-state.js --ticket <id> --state agent::ready`).
     Blocked outranks a wedge but not a cycle (fix the graph first).

4. **Per-run epilogue (N>1).** Once step 3 reports `epilogueDue: true`, run
   `node .agents/scripts/plan-run-epilogue.js --stories 101,102` — audit
   roster, follow-up roll-up, sibling coherence. A single-Story run skips it
   ([reference § Per-run epilogue](helpers/deliver-reference.md)).

## Branch model (authoritative)

`story-<id>` → PR → `main` (squash + required checks), per digest § 2.
Dependent Stories land sequentially so each builds on the previous merge.
Ceremony depth (profiles + derived level via `ceremony-routing.js`, review
depth reading the same level):
[`helpers/deliver-reference.md` § Ceremony](helpers/deliver-reference.md).

## Reading a Story's outcome

Each Story ends in exactly one schema-validated terminal envelope — `landed` |
`pending` | `blocked` | `failed`. Statuses, exits, and fields:
[`helpers/deliver-digest.md`](helpers/deliver-digest.md) § 5.

`pending` is **not** a failure: the bounded wait expired with the PR healthy
(or a human owns the merge), nothing was mutated, and `nextCommand` resumes it
— run that rather than re-dispatching.

For a Story in an unclear state — including the merged-but-label-stale one a
re-run refuses outright — probe it read-only with
`node .agents/scripts/deliver-recover.js --story <storyId>`.

## Constraints

- **Land or block — never a silent local build** (digest § 2). Attended
  delivers default to close-and-land (`delivery.routing.closeAndLand: true`);
  rest at `agent::closing` only when a human owns the merge.
- **`/deliver` never plans.** Planned tickets come from [`/plan`](plan.md), and
  an over-scope prompt **escalates and ends** — never invoke `/plan` in this
  session to rescue it ([`helpers/deliver-light.md`](helpers/deliver-light.md)
  § Escalation is terminal). The router performs no git/label mutations;
  `deliver-story` owns every script.

## See also

- [`/plan`](plan.md) — unified planning entry point.
- [`helpers/deliver-story.md`](helpers/deliver-story.md) — the one engine.
- [`helpers/deliver-light.md`](helpers/deliver-light.md) — the unplanned
  prompt path, shared with `/plan` Gate #1.
