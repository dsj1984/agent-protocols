---
name: gates-and-baselines
description:
  Governs quality gates and the unified-baseline snapshots. Use when authoring
  a baseline refresh commit (coverage, CRAP, maintainability, duplication,
  dead-exports), when setting up or modifying CI quality gates, or when
  introducing a new gate that asserts on pre-existing state without turning the
  base branch red.
allowed_tools:
  - Read
  - Write
  - Bash
---

# Gates and Baselines

## Policy Capsule

- **No gate may be skipped.** Failing lint means fix lint; a failing test means fix the code, not `.skip` or delete the test. Feed CI failure output back verbatim and reproduce locally before re-pushing.
- **Introducing a gate that asserts on pre-existing state** (doc-drift, lint-vocabulary, dependency-cycle, missing-coverage) MUST land green at merge: either advisory-first (report-only until the backlog is burned down) or with the populated baseline committed in the same change that turns the gate on. Never wire a gate into `requiredChecks` that lands red on latent findings nobody authored.
- **Refresh a baseline only when the change is deliberate** — a rename/move, an operator-approved complexity bump, a signed-off perf delta, an intentional API-surface change. Never refresh to paper over an unintentional regression; fix the regression instead.
- **Pick the refresh that matches why you are refreshing** — the wrong scope silently no-ops. `npm run <kind>:update` is **diff-scoped**: it re-scores only files changed in `origin/main..HEAD` and preserves every other row verbatim; that is what you want after changing code. `npm run <kind>:reanchor` is the same script with `--full-scope` and re-scores every file in every target dir; that is what you want when the baseline is **stale** (a scorer-version bump, a coverage-shape change, accumulated drift), because a diff-scoped run would leave the stale rows exactly as they were.
- Kinds carrying both scopes: `coverage`, `crap`, `maintainability`, `duplication`. Dead-exports has no scope axis — knip scores the whole graph, so `npm run dead-exports:update` (both passes) is the only sanctioned way to write `baselines/dead-exports.json` / `baselines/dead-exports-production.json`; never hand-edit them. Run any refresh on the **Story branch**, never on `main`.
- Verify the refresh diff is scoped to the relevant `baselines/<kind>.json` (plus cosmetic `package-lock.json` churn only). If unrelated files appear, STOP — the refresh is contaminated. Stage baseline files **explicitly** (`git add baselines/<kind>.json`); never `git add -A` in a refresh commit.
- Commit-subject contract: the **Conventional-Commits** subject `chore(baselines): refresh <kind> snapshot for <reason>` — never an ad-hoc leading token like `baseline-refresh:` (commitlint and the planner validator reject it). The body is **mandatory** and non-empty: what changed, why the new floor is correct, and the Story that triggered it.
- Add the machine-readable trailer `baseline-refresh: true` (git-trailer `Key: value` style) and `Story: #<storyId>` to that body. Never pass `--no-verify`; the `commit-msg` hook (commitlint) MUST run and pass.
- After the refresh lands, re-run `node .agents/scripts/check-baselines.js` to confirm the gate passes against the new snapshot; if it still fails, a sibling kind drifted — refresh that kind too.
- Open a [`reference.md`](reference.md) section only when the task engages it: the baseline roster, the per-kind refresh table, and the step-by-step procedure live there.
