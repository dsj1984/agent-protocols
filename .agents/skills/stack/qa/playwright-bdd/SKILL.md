---
name: playwright-bdd
description:
  Wires Gherkin `.feature` files to Playwright via the `playwright-bdd`
  library. Use when running BDD scenarios on a Playwright runtime — pairs
  with the `gherkin-authoring` skill (scenario prose) and the `playwright`
  skill (browser conventions). Drives execution by tag expression with
  trace-first debugging and Playwright-native sharding.
vendor: playwright
---

# Skill: playwright-bdd

## Policy Capsule

- Complete the step-reuse sequence in [`gherkin-standards.md` § Step Reuse](../../../../rules/gherkin-standards.md#step-reuse--grep-before-you-write) before any scenario text is written, and report its results; that rule is the only home for it.
- Keep `.feature` files free of Playwright API calls — scenarios describe intent, step definitions translate to browser actions.
- Generate step bindings into a dedicated directory (e.g. `.features-gen/`) and add it to `.gitignore`; never commit generated specs, and point `testDir` at that directory.
- Drive runs by tag expression (`npx bddgen && npx playwright test --grep "@smoke and not @flaky"`), not filename globs; fail the run when generation matches zero scenarios.
- Inject fixtures via `createBdd` rather than pulling singletons from module scope; reset persistent state through fixture teardown, not stray `After` hooks.
- Reuse `storageState` for authenticated scenarios — create a logged-in user fixture instead of repeating login steps in `Background`.
- Keep `trace: 'on-first-retry'` (or `'retain-on-failure'`) enabled; reproduce failures by `@scenario-id` tag, not by title, and use `PWDEBUG=1` rather than `page.pause()` in step files.
- Shard with Playwright's native `--shard=i/N`; never partition by tag expression across CI jobs.
- Use Playwright projects (not Cucumber profiles) for browser matrix fan-out, so sharding, retries, and trace config stay in one place.

Guidance for running Gherkin `.feature` files against Playwright via
`playwright-bdd`. Pairs with the `gherkin-authoring` skill (scenario prose) and
the `playwright` skill (browser-level conventions); this skill covers the wiring
between them.

> **Version:** consumers pick their own `playwright-bdd` version. This skill
> documents behavioral constraints, not a pinned release.

## Project-Specific Wiring

The capsule above is the contract. Three points bind this runtime to the rest
of the framework:

- **Tags come from one taxonomy.** Selection uses the canonical set defined in
  [`.agents/rules/gherkin-standards.md` § Tag Taxonomy](../../../../rules/gherkin-standards.md#tag-taxonomy)
  (`@smoke`, `@risk-high`, `@platform-*`, `@domain-*`, `@flaky`, `@skip`). Do
  not invent parallel tag vocabularies in the runner config; extend via
  `@domain-*` only. The agent-driven `/qa-run` selector mirrors the same tag
  expressions, so a scenario set is addressable identically from both surfaces.
- **`@flaky` runs in its own non-gating job.** Quarantine `@flaky` scenarios in
  a dedicated CI job that does not gate the merge queue, and never silently
  retry flakes inside the gating suite. `@flaky` is a debt marker with an owner,
  not a permanent label.
- **The Cucumber JSON report is the headless evidence artifact.** Register the
  Cucumber HTML/JSON reporter alongside the Playwright HTML reporter and publish
  it (with the trace zips) so a headless CI invocation emits machine-readable
  evidence next to the agent-driven [`/qa-run`](../../../../workflows/qa-run.md)
  sweep. Wire the generate-then-run sequence to a single npm script so operators
  never reconstruct it by hand.

## Cross-References

- Scenario authoring rules: `.agents/rules/gherkin-standards.md`.
- Scenario authoring skill: `.agents/skills/stack/qa/gherkin-authoring/SKILL.md`.
- Browser-level conventions: `.agents/skills/stack/qa/playwright/SKILL.md`.
- Operator entry point: `.agents/workflows/qa-run.md`.
