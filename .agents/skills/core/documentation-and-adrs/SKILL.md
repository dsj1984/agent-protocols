---
name: documentation-and-adrs
description:
  Records decisions and documentation. Use when making architectural decisions,
  changing public APIs, shipping features, or when you need to record context
  that future engineers and agents will need to understand the codebase.
---

# Documentation and ADRs

## Policy Capsule

- Document the **why**, not the what. Capture context, constraints, alternatives considered, and trade-offs — code already shows what was built.
- Write an ADR for any decision that would be expensive to reverse (framework choice, data model, auth strategy, API architecture, hosting platform).
- Mandrel ships **two first-class decisions-log layouts** — pick one at onboarding (see [Decisions-log layouts](reference.md#decisions-log-layouts)): the **single-file dated-entry** `docs/decisions.md` (default; best for small projects) or the **index + `docs/decisions/` directory** (MADR-style, one file per ADR; best once the log outgrows a single file). Either way, the canonical ADR sections are **Status, Date, Deciders, Context, Decision, (Alternatives Considered), Consequences**.
- Mark an ADR's status as `Accepted`, `Superseded by ADR-XXX`, `Deprecated`, or `Reverted (<date>)` — a reverted decision was **undone** rather than replaced, so unlike a superseded one it has no successor to point at. Never silently delete an ADR — supersede it.
- Keep user-facing docs (README, API docs, changelog) updated as part of the change — out-of-date docs are bugs.
- Pair every public API change with a changelog entry that links the relevant Story and any superseding ADR.

## Long-form reference — read on demand

The capsule above is the contract and the whole always-read surface of this
skill. The long-form material behind it — patterns, worked examples,
checklists, and rationalizations — lives in the on-demand sibling
[`reference.md`](reference.md), matching the split the always-on rules already
use ([`rules/git-conventions.md`](../../../rules/git-conventions.md) ⇄
[`git-conventions-reference.md`](../../../rules/git-conventions-reference.md)).
Activating this skill costs the capsule; open a section below only when the
task actually engages it.

- [Overview](reference.md#overview)
- [When to Use](reference.md#when-to-use)
- [Architecture Decision Records (ADRs)](reference.md#architecture-decision-records-adrs)
- [Inline Documentation](reference.md#inline-documentation)
- [API Documentation](reference.md#api-documentation)
- [README Structure](reference.md#readme-structure)
- [Changelog Maintenance](reference.md#changelog-maintenance)
- [Pruning & Archiving](reference.md#pruning-archiving)
- [Documentation for Agents](reference.md#documentation-for-agents)
- [Common Rationalizations](reference.md#common-rationalizations)
- [Red Flags](reference.md#red-flags)
- [Verification](reference.md#verification)
