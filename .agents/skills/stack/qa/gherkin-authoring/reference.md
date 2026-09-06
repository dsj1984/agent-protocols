# Gherkin Authoring — Reference (on-demand)

**Read this when** a task engages one of the sections below and the Policy
Capsule in [`SKILL.md`](SKILL.md) does not settle it on its own. The capsule is
the contract; this file is the reference material behind it. The enforcement
rules (tag taxonomy, forbidden patterns, Outline conventions, step reuse) are
owned by the SSOT rule,
[`gherkin-standards.md`](../../../../rules/gherkin-standards.md).

## Step-Definition Library Structure

Authoring scenarios and maintaining steps are the same job split across two
files. Keep that coupling visible:

```text
tests/
  steps/
    _common/          # actor, auth, navigation — reused across every domain
      auth.steps.ts
      navigation.steps.ts
    billing/          # one directory per @domain-* tag
      invoices.steps.ts
    _deprecated/      # steps pending migration
```

- One directory per `@domain-*` tag; `_common/` holds cross-cutting steps.
  Files are named by the noun the steps act on (`invoices.steps.ts`). Two levels
  (`steps/<domain>/<noun>.steps.ts`) is the nesting ceiling.
- Step text follows the scenario text verbatim — divergence between scenario
  prose and step text is a bug. Parameterize only over values that actually
  vary; keep implementations ≤20 lines (a longer one signals a missing helper).
- **Reuse before authoring, and deprecate cleanly.** Both are the SSOT rule's:
  [gherkin-standards § Step Reuse](../../../../rules/gherkin-standards.md#step-reuse--grep-before-you-write).
  A superseded definition moves into `steps/_deprecated/` with a comment naming
  its replacement, every call site migrates in the same PR, and the
  `_deprecated/` entry is deleted when the migration lands.

## Authoring Checklist

Before opening a PR that adds or edits a `.feature` file:

- [ ] Every Scenario/Outline carries exactly one `@domain-*` tag.
- [ ] No forbidden patterns (SQL, status codes, selectors, URLs, payloads,
      framework names, explicit waits) appear in prose.
- [ ] Each scenario has exactly one `When`.
- [ ] `Then` clauses assert user-visible outcomes, not implementation.
- [ ] `Background` is justified (applies to every scenario in the file).
- [ ] If a Scenario Outline is used, the matrix is bounded (≤12 rows) and the
      shape is truly identical across rows.
- [ ] Every step phrase matches an existing step definition **or** is
      accompanied by a new step definition in the right domain directory.
- [ ] Reads standalone — a product reader who has never seen the codebase can
      understand the intent without opening a step file.
