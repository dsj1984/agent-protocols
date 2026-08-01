---
description:
  Unified planning entry point. Interrogate → author → persist. Emits one
  Story by default; splits into N>1 only under the default-single split
  policy.
---

# /plan

> **Lean spine.** Happy path + gate list; edge-case detail lives on demand in
> [`helpers/plan-reference.md`](helpers/plan-reference.md).

## Inputs

Single planning path — there is no Epic/Story router, no scope-triage
`epic|story` verdict. **Derive the mode from what the operator typed, announce
it, act**:

| Invocation | Mode | Behavior |
| --- | --- | --- |
| `/plan` | ask | Ask what to plan; nothing runs first. |
| `/plan add a --json flag to doctor` | seed | Ideation from prose: interrogate → author **one Story by default** → persist. |
| `/plan temp/notes/idea.md` | seed-file | Same, from notes. An argument resolving to an existing file is a path, not prose. |
| `/plan 4712[,4713…]` | tickets | Fetch issue(s), analyze into proper Stories (prefer N=1 rewrite). |
| `/plan 4712`, already delivered | amends | Amend a shipped Story from a **delta envelope**, not a re-interrogation. |

**Resolving a bare id.** Read live state rather than asking: `agent::done` can
only be amended, an open unplanned issue can only be planned. **Announce the
derivation** — "4712 is `agent::done` → amending" — so a wrong read costs one
correction. Ask **only** for an open Story already at `agent::ready`. `--body`
is not a `/plan` entry; persist goes via `plan-persist.js`.

## Saying what you want

No flags to remember — state intent and the workflow fills in the CLI
([reference](helpers/plan-reference.md)). Run any script with `--help` rather
than copying its surface.

`--yes` is **runner-set, never operator-typed** — cron, `/loop`, and headless
dispatch set it to mean *nobody is at the keyboard*, which auto-proceeds the
gates below (#1 and #2). Never offer it to an operator or an attended run.

## Default-single split policy

Author **one Story** unless the pieces have **near-zero overlap** or sit across
an **architectural seam** (different deployables, migration vs consumer).
Coupled work stays one Story — `## Slicing` checkpoints, not sibling tickets;
when N>1 every acceptance criterion belongs to exactly one Story
(`assertAcceptancePartition` refuses coupled splits). **N=1 is lean.**

## Procedure

### 1. Interrogate

```bash
node .agents/scripts/plan-context.js --seed "<seed>" \
  --out temp/plan-<slug>/plan-context.json
# or: --seed-file <path>  |  --tickets 123,456  |  --amends #<id>
```

**Always pass `--out`.** Persist auto-discovers the envelope from `--plan-dir`
and derives source ids from its `sourceTickets[]`; the CLI also writes
**`stories.template.json`**, step 2's skeleton.

The envelope carries docs context, the story-author prompt, `sourceTickets[]`,
`duplicates[]` (open **Stories**, never Epics) and advisory `complexitySignals`
(**no routing authority**). A trivial scope earns
`--route-downgrade-reason "<why>"` at persist — shape-validated, failing closed
to `full` ([detail](helpers/plan-reference.md)).

**Triage each unknown by resolver** ([detail](helpers/plan-reference.md)): an
**AFK** unknown (research settles it) is resolved before authoring, never
assumed; a **HITL** unknown (an operator call) goes to Gate #1 as "needs your
decision". Under `--yes` do not ask free-form operator questions — AFK unknowns
are still researched; only HITL unknowns land in Key Assumptions, each marked a
decision-made-by-default.

**Gate #1** — STOP to confirm the sharpened plan intent and any
duplicate-candidate review. Under `--yes`, auto-proceed.

On a truthy `deliverLightSuggestion.suggested`, offer — **advisory, never an
automatic reroute** — to deliver the seed instead of planning it; on confirm,
route **in this session** into
[`helpers/deliver-light.md`](helpers/deliver-light.md), filling its gate from
this envelope, not the raw seed. Under `--yes` it is only recorded. A truthy
`complexitySignals.uiSurface` marks a UI-touching plan: name
[`/prototype`](prototype.md) as an operator option, never invoke it here.
[Both offers](helpers/plan-reference.md).

### 2. Author

**One-shot authoring.** Start from `stories.template.json`; author
`stories.json` in one pass. `body` is markdown **or** a structured object;
persist parses either, serializes canonical markdown and syncs top-level
`acceptance[]` / `verify[]` into it — never dual-author those lists.

**Grounding = your reads + Phase 8.** Nothing inventories the repo for you: read
each file you cite, then persist's file-assumption gate hard-errors on every
`{path, assumption}` missing from the real tree. Entry fields (the
`stories.template.json` shape): [reference](helpers/plan-reference.md).

Artifacts under `temp/plan-<slug>/`: `stories.json` (**length 1 by default**;
over-budget Specs fail closed — split or tighten, never under `docs/`); optional
`techspec.md` (**N===1 only** — folded into `## Spec`); optional
`acceptance-manifest.json` (N>1 partition — `--plan-acceptance`). For N=1 use
the envelope `systemPrompts.story`; split only under the policy above.

**Tickets mode:** every Story authors a top-level `supersedes[]`; persist
refuses a partial map ([shape](helpers/plan-reference.md)).

### 2.5 Critics

```bash
node .agents/scripts/plan-critics.js \
  --stories temp/plan-<slug>/stories.json \
  [--tech-spec temp/plan-<slug>/techspec.md]
```

Run **before** persist — the last point a finding folds into a re-author.
It exits 0 on **any** verdict (verdicts route work, they do not gate) and exits
**1** only on a usage/IO error — no critic ran, no skip ledgered: **do not
proceed to Persist**, fix and re-run.

- **Both `dispatch: false`** — proceed to Persist (each skip is ledgered).
- **Either `dispatch: true`** — dispatch **one fresh-context, maker-blind
  sub-agent per firing critic** (hand it only the draft artifacts, never the
  authoring transcript), fold findings into Gate #2 or a re-author round, re-run
  this step. Pre-mortem triggers (incl. the external-dependency probe), the
  advisory-only `textHygiene.findings[]` lints and dispatch shape:
  [`helpers/plan-reference.md` § Critic dispatch detail](helpers/plan-reference.md).

### 3. Persist

**Gate #2** — STOP for approval before persist **only** when the operator asked
to review (`--force-review`). Under `--yes`, auto-proceed.

Run persist with `--dry-run` **first** — same command, GitHub writes suppressed;
every gate runs before the first `createIssue`
([the list](helpers/plan-reference.md)):

```bash
node .agents/scripts/plan-persist.js \
  --stories temp/plan-<slug>/stories.json \
  --plan-dir temp/plan-<slug> \
  [--plan-acceptance temp/plan-<slug>/acceptance-manifest.json] \
  [--tech-spec temp/plan-<slug>/techspec.md] \
  [--source-tickets 123,456]
```

At lite shape, `--chain-on-clean` chains a clean dry-run into the real persist
in one round-trip; a full plan keeps its review trip.

Persist creates `type::story` issue(s) plus a `plan-run::<id>` grouping label
(**metadata only**); N>1 `depends_on` edges become `blocked by #<id>` footers.
`agent::ready` is the **terminal** flip after receipts land; stdout is pure
JSON. In tickets mode it resolves source ids **envelope-first** and closes each
as `not_planned` with a comment (default on;
[detail](helpers/plan-reference.md)).

## Constraints

- `/plan` starts delivery **only** through a confirmed Gate #1 light route —
  never off its own authored Stories, which land via [`/deliver`](deliver.md).
- Duplicate search targets open Stories (`type::story`), not Epics; and
  deterministic gates still fail closed under `--yes`.

## See also

[`/deliver`](deliver.md), [`/audit-to-stories`](audit-to-stories.md),
[`helpers/plan-reference.md`](helpers/plan-reference.md) (on-demand detail),
[`core/scope-triage`](../skills/core/scope-triage/SKILL.md) — optional
split-advisory notes only (no routing verdict).
