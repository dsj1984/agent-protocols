# Skill: playwright-bdd

Guidance for running Gherkin `.feature` files against Playwright via
`playwright-bdd`. Pairs with the `gherkin-authoring` skill (scenario prose) and
the `playwright` skill (browser-level conventions); this skill covers the
wiring between them.

> **Version:** consumers pick their own `playwright-bdd` version. This skill
> documents behavioral constraints, not a pinned release.

## 1. Core Principles

- **One source of truth per scenario:** `.feature` files describe intent; step
  definitions translate intent into Playwright calls. Never author browser
  actions in `.feature` prose.
- **Deterministic tag filtering:** every scenario carries enough tags that any
  CI shard can be selected by a tag expression without inspecting file paths.
- **Fixture-per-scenario isolation:** scenarios must not share mutable state.
  Treat each scenario as a fresh browser context.
- **Trace-first debugging:** keep the Playwright Trace Viewer workflow intact —
  `playwright-bdd` wraps Playwright, it does not replace its diagnostics.

## 2. Config Patterns

- Generate step-definition bindings into a dedicated output directory (commonly
  `.features-gen/`) and add it to `.gitignore`. Do not commit generated specs.
- Point `playwright.config.ts` at the generated directory via `testDir`; keep a
  single `defineBddConfig` block that lists `features` and `steps` paths.
- Register the Cucumber HTML/JSON reporter alongside the Playwright HTML
  reporter so sprint-testing evidence matches the format expected by
  `/run-bdd-suite`.
- Use Playwright projects (not Cucumber profiles) for browser matrix fan-out —
  keeps sharding, retries, and trace config in one place.

## 3. Fixture Composition

- Extend Playwright's `test` via `playwright-bdd`'s `createBdd` so fixtures
  (auth state, API clients, seeded data) are injected into `Given`/`When`/
  `Then` callbacks by name, not pulled from module-level singletons.
- Layer fixtures: base Playwright fixtures → domain fixtures (authenticated
  user, seeded tenant) → scenario-scoped helpers. Each layer depends only on
  the layer below.
- Reset persistent state with fixture teardown, not with `After` hooks buried
  in step files — teardown order is then deterministic and visible in the
  fixture graph.
- Reuse `storageState` for authenticated scenarios; create a "logged-in user"
  fixture rather than repeating login steps in `Background`.

## 4. Tag-Filtered Execution

- Drive runs via tag expressions, not filename globs:
  `npx bddgen && npx playwright test --grep "@smoke and not @flaky"`.
- Reserve a small canonical tag set (`@smoke`, `@regression`, `@slow`,
  `@flaky`) per the `gherkin-standards` rule; domain tags use the
  `@domain-*` extension syntax.
- Wire the `/run-bdd-suite <tag-expression>` workflow to a single npm script
  so operators never reconstruct the generate-then-run sequence by hand.
- Fail the run if generation produces zero matching scenarios — a silent
  empty suite is worse than a red build.

## 5. Debug & Trace Workflow

- Keep `trace: 'on-first-retry'` (or `'retain-on-failure'`) in the Playwright
  config. `playwright-bdd` preserves the trace attachment because each
  scenario maps to a Playwright test.
- Reproduce a single failing scenario with `--grep "@scenario-id"` rather than
  the scenario title — titles change, tags are stable.
- Open traces with `npx playwright show-trace` against the artifact produced
  under `test-results/`; the trace timeline annotates each `Given`/`When`/
  `Then` step, which is the primary debug affordance.
- For step-definition bugs, run with `PWDEBUG=1` to drop into the inspector at
  the failing step — do not add `page.pause()` calls inside step files.

## 6. Sharding & CI Notes

- Shard with Playwright's native `--shard=i/N`; do not partition by tag
  expression across jobs — tag-sharding makes flake triage non-deterministic.
- Run `bddgen` once per job before `playwright test`; cache the generated
  directory only if the cache key includes every `.feature` and step file.
- Publish the Cucumber HTML/JSON report as the evidence artifact consumed by
  the `sprint-testing` workflow, alongside the Playwright HTML report and any
  trace zips.
- Quarantine `@flaky` scenarios with a dedicated job that does not gate the
  merge queue; do not silently retry flakes in the main suite.

## 7. Cross-References

- Scenario authoring rules: `.agents/rules/gherkin-standards.md`.
- Browser-level conventions: `.agents/skills/stack/qa/playwright/SKILL.md`.
- Operator entry point: `.agents/workflows/run-bdd-suite.md`.
- Evidence handoff: `.agents/workflows/sprint-testing.md`.
