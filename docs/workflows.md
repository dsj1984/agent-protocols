# Workflow (Slash-Command) Reference Index

This is a **reference index** of every slash-command skill shipped under
`.agents/workflows/`. The canonical workflow narrative lives in
[`.agents/SDLC.md`](../.agents/SDLC.md) — read that first to understand how the
commands compose. This file is only for "which command does X?" lookups.

Every command file lives at `.agents/workflows/<name>.md` and is auto-synced to
`.claude/commands/<name>.md` by `npm run sync:commands` so it shows up as a
`/`-prefixed slash command in Claude Code.

## Planning

| Command                  | Purpose                                                                                   | Typical caller |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------- |
| `/sprint-plan`           | Local, one-shot wrapper: generate PRD + Tech Spec, pause for confirmation, then decompose.| Operator in IDE |
| `/sprint-plan-spec`      | Phase 1 of remote planning — generate PRD + Tech Spec; flip Epic to `agent::review-spec`. | `agent::planning` label → `epic-plan.yml` |
| `/sprint-plan-decompose` | Phase 2 of remote planning — decompose into Feature/Story/Task; flip Epic to `agent::ready`. | `agent::decomposing` label → `epic-plan.yml` |

## Execution

| Command                     | Purpose                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `/sprint-execute`           | Single entry point. Routes by `type::` label — Epic Mode for `type::epic`, Story Mode for `type::story`. |
| `/sprint-hotfix`            | Rapid remediation of regressions on a Task feature branch after a failed integration candidate.   |

> `/sprint-execute-epic` and `/sprint-execute-story` were retired in v5.15.0.
> The single `/sprint-execute` router replaces both; its internal engines
> (`epic-runner.js`, `sprint-story-init.js`, `sprint-story-close.js`) are
> unchanged.

## Closure

| Command                        | Purpose                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `/sprint-close`                | Close an Epic end-to-end. Internally auto-invokes `/sprint-code-review` and `/sprint-retro` before merging `epic/<id>` to `main`. |
| `/sprint-code-review`          | Comprehensive code review of the Epic's changes. Auto-invoked by `/sprint-close`; rarely called directly.                         |
| `/sprint-retro`                | Retrospective from ticket graph and friction logs; posted as a structured comment on the Epic.                                    |
| `/sprint-testing`              | Ingest the Cucumber report produced by `/run-bdd-suite` as sprint evidence.                                                       |
| `/run-bdd-suite`               | Run a tag-filtered BDD acceptance suite and collect a Cucumber report.                                                            |

## Audit suite

Twelve specialized audits. Each activates the corresponding persona and can be
invoked manually or automatically at `gate1`–`gate4` by the audit orchestrator.

| Command                    | Focus                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ |
| `/audit-accessibility`     | Lighthouse performance + accessibility                                         |
| `/audit-architecture`      | Architecture and clean-code structure                                          |
| `/audit-clean-code`        | Clean-code and maintainability                                                 |
| `/audit-dependencies`      | Dependency audit and upgrade                                                   |
| `/audit-devops`            | DevOps infrastructure                                                          |
| `/audit-performance`       | Performance and bottleneck analysis                                            |
| `/audit-privacy`           | Privacy and PII data flows                                                     |
| `/audit-quality`           | Testing and quality assurance                                                  |
| `/audit-security`          | Security and vulnerability scan                                                |
| `/audit-seo`               | SEO and Generative Engine Optimization                                         |
| `/audit-sre`               | Production release-candidate SRE readiness                                     |
| `/audit-ux-ui`             | UX/UI consistency and design system adherence                                  |

## Git operations

| Command                   | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `/git-commit-all`         | Commit all outstanding changes to the current branch.                         |
| `/git-push`               | Commit all outstanding changes and push to the remote.                        |
| `/git-merge-pr`           | Analyze, validate, resolve conflicts, and merge a given pull request.         |
| `/delete-epic-branches`   | Hard reset — delete all branches associated with an Epic and its children.    |
| `/delete-epic-tickets`    | Hard reset — delete all child issues of an Epic (not the Epic itself).        |

## Setup & meta

| Command                      | Purpose                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `/bootstrap-agent-protocols` | Initialize a GitHub repo with the v5 label taxonomy, project fields, and (v5.15.0+) the default Kanban board. |
| `/sync-agents-config`        | Reconcile `.agentrc.json` against `.agents/default-agentrc.json` — adds missing fields, removes obsolete ones. |

## Internal / reference-only

Not invoked directly by operators, but referenced from other workflows:

- `_merge-conflict-template.md` — canonical procedure for resolving a merge
  conflict, included by reference from `sprint-execute` and `sprint-hotfix`.
- `worktree-lifecycle.md` — per-story `git worktree` isolation model, including
  node_modules strategies, Windows notes, and escape hatches.

## Adding a new workflow

1. Author `.agents/workflows/<name>.md` with a YAML frontmatter block (`name`,
   `description`).
2. Run `npm run sync:commands` — this copies the file into
   `.claude/commands/<name>.md` so it surfaces as a `/`-prefixed command.
3. Add a row to this index and (if the command is part of the canonical
   lifecycle) a reference in [`.agents/SDLC.md`](../.agents/SDLC.md).
