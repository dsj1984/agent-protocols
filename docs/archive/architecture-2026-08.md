# Archived architecture history — 2026-08

Finished-work history relocated verbatim out of
[`docs/architecture.md`](../architecture.md) by Story #4924. Each section below
narrates machinery the repository no longer ships, or a defect that was
diagnosed and closed — record, not guidance.

**Archived, not deleted.** The bodies below are word-for-word as they stood in
`docs/architecture.md` before this Story. No prose was rewritten, summarized,
or reordered.

**Still-live guidance was lifted out before the move.** Every constraint in
these sections that still binds current code stayed in `docs/architecture.md`
as a one-line "do not reintroduce" note at the same place the section used to
sit. Read the live doc for what applies; read this file for the record of what
was removed and why.

| Section | Relocated because |
| --- | --- |
| Failure auditability — what `ErrorJournal` was | The typed-context stratum it lived in was deleted (#3908). The live doc keeps the "nothing can inject it" warning; this is the backstory. |
| Why the codebase snapshot was deleted | The snapshot and its config block were deleted in Story #4811. The live doc keeps the two grounding mechanisms that replaced it; this is the post-mortem. |
| The epic-runner-era concurrency surface | `DEFAULT_CONCURRENCY` / `resolveConcurrency` / `CommitAssertion` / `ProgressReporter` all went with the in-process stratum (#3908). |
| `lint-staged` biome config: `--no-errors-on-unmatched` | Story #3529's root cause was fixed by Story #3489 (PR #3531). The flag's one-line rationale stays live; the 29-line incident write-up is history. |
| Deleted listeners, CLIs and the heartbeat emitter | Four one-off tombstones for surfaces removed between #3908 and Story #4542. The live doc keeps each surviving statement; these are the removal notes. |

---

## Deleted listeners, CLIs and the heartbeat emitter

The epic-runner-era `blocker-handler` and `wave-observer` listeners were
deleted with the in-process stratum (#3908); `agent::blocked` remains the
sole runtime pause point, enforced by the workflow prose rather than a
resident listener.

The retired `epic-audit-prepare.js` / `epic-audit-recheck.js` CLIs were deleted
with the v2 Story-only cutover.

Lens selection is **not** risk-routed. Story #4542 deleted the risk→lens router
(`resolveAuditLenses`): it had zero callers while this section and two other
shipped documents claimed it ran inside close.

A `story.heartbeat` event and its
PostToolUse-hook emitter once existed, but the emitter required an
`epicId >= 1` that v2 — which has no Epics — never supplied, so it could
never fire; it was deleted (A22) rather than repaired.

Story #2259 (Epic #2172) retired the legacy deliver-runner CLI
wrapper; the slash command supplants it entirely.

---

## Failure auditability — what `ErrorJournal` was

There is **no** `ErrorJournal` and no `lib/orchestration/error-journal.js`. It
was an in-process-runner concept threaded through the typed context classes in
`lib/orchestration/context.js`, and died with them and the epic-runner stratum
(#3908) — do not write `errorJournal?.record(...)`; nothing can inject it. Two
file-based surfaces replace it: the append-only signals stream
(`lib/observability/signals-writer.js`, written by `diagnose-friction.js`) and
the per-script logs under `temp/orchestration/`.

The epic-runner progress reporter went with the same stratum (#3908). Live
Story progress surfaces via lifecycle ledger events and structured comments
(`story-init`, `friction`, `verification-results`, `follow-ups`) posted by the
single-story init/close path.

---

## Why the codebase snapshot was deleted

The snapshot grounded nothing it promised. Its default include globs guessed
`app/**` singular and matched zero product files under the standard `apps/**`
monorepo layout; its remedies pointed at knobs (`tier: "medium"`, a narrower
`include`) that re-signatured the same already-filtered set and could not fix
a missing include; and its cited-but-absent signal inverted into noise
whenever the snapshot itself was the incomplete artifact.

---

## The epic-runner-era concurrency surface

The whole epic-runner-era
concurrency surface (`DEFAULT_CONCURRENCY` / `resolveConcurrency`,
`CommitAssertion`, the `ProgressReporter` listener) went with the dead
in-process stratum (#3908) — do not confuse the surviving
`resolveConcurrencyCap` with the deleted `resolveConcurrency`. Story #4545
deleted the perf-summary throughput surface; the local `signals.ndjson`
stream and the retro's aggregate over it are what remain.

The `CommitAssertion` post-wave guard and its `verifySingleResult` successor
both went with the epic-runner / wave machinery. The guard against a Story
being reported "done" without verifiable completion is now structural:
`agent::done` follows the confirmed squash-merge of the Story's own PR.

---

## `lint-staged` biome config: `--no-errors-on-unmatched`

The biome steps in `.lintstagedrc` (`biome check` / `biome format`) carry
the `--no-errors-on-unmatched` flag. This is the canonical fix for the
defect tracked in **Story #3529**.

**Background.** `biome.json` sets `vcs.useIgnoreFile=true`, so biome honours
`.gitignore`. Epic #3436 (PR #3485) briefly added `/.agents/` to
`.gitignore` as part of the in-flight npm-distribution migration. Because
`.agents/` is the framework's own committed source tree, every staged
`.agents/**/*.js` change was then handed to biome as an *ignored* path:
biome processed 0 files and **exited 1**, hard-failing the pre-commit hook
on any framework `.js` commit. Story #3489 (PR #3531) removed the
`/.agents/` ignore in this source repo (the `.gitignore` NOTE block records
why the framework repo keeps `.agents/` tracked while consumer projects
ignore their materialized copy), which eliminates the original trigger.

**Why the flag stays.** `--no-errors-on-unmatched` is retained as a
defensive default rather than reverted now that #3489 fixed the root cause.
Without it, biome treats an "all staged paths ignored" set as an error and
exits non-zero; with it, biome still lints/formats every *non-ignored*
staged file (no silent coverage loss — verified: a staged `.agents/scripts/`
edit passes the hook and is linted) but no longer hard-fails when a commit
happens to stage only ignored paths. The `.gitignore` in this repo still
ignores local-override paths (`.agents/*.local.md`, `.agents/*local.json`)
and consumer projects ignore their entire materialized `/.agents/` copy, so
an all-ignored staged set remains a reachable state the flag guards against
at zero cost. `.lintstagedrc` is plain JSON and cannot carry an inline
comment, so this rationale lives here.
