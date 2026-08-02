# Archived data-dictionary entries — 2026-08

Retired sections relocated verbatim out of
[`docs/data-dictionary.md`](../data-dictionary.md) by Story #4924. Each
documents a surface the repository no longer implements — its entire body was
already a statement that the thing is gone, so it defined no live vocabulary.

**Archived, not deleted.** The bodies below are word-for-word as they stood in
`docs/data-dictionary.md` before this Story. No prose was rewritten or
summarized.

**Nothing live was lifted out.** Each section's replacement surface was already
named inside it and is repeated in the one-line pointer left in the live doc.

| Section | Retired because |
| --- | --- |
| StoryPerfSummary / EpicPerfReport | Both payloads and their schemas were deleted with the execution-analysis surface (Story #4545). |
| Dispatch Manifest | Deleted with the Epic tier in v2.0.0; nothing writes it. |
| Health-Monitor Refresh Cadence | The `epic-run-progress` comment and its progress reporter went with the in-process epic-runner stratum (#3908 / PR #3936). |
| Retro Heuristic | The `epic-retro` helper and `retro-heuristics.js` were deleted with the Epic delivery path. |

---

## StoryPerfSummary / EpicPerfReport

Both payloads and their schemas were deleted with the execution-analysis
surface that produced them. Nothing writes a `structured:story-perf-summary`
or `structured:epic-perf-report` comment, and neither is a valid structured
comment type any more.

---

## Dispatch Manifest

> **Historical.** The dispatch manifest (`temp/dispatch-manifest-<epicId>.json`,
> its structured comment, and its renderer `render-manifest.js`) was deleted
> with the Epic tier in v2.0.0 — nothing writes it. The v2 dispatch record is
> the Story's own GitHub surface: labels, structured comments, and the
> `story-<id>` PR.

---

## Health-Monitor Refresh Cadence

> **Historical.** The Epic Health (`epic-run-progress`) structured comment
> and `lib/orchestration/epic-runner/progress-reporter/` were deleted with
> the in-process epic-runner stratum (PR #3936 / #3908). v2 Story delivery
> does not refresh an Epic health comment on a wave cadence.
>
> Live progress surfaces are Story-scoped structured comments
> (`story-init`, `friction`, `verification-results`, `follow-ups`) plus the
> lifecycle ledger under `temp/run-<id>/`. The former lifecycle-bus
> `structured-comment-poster` listener is also deleted.

---

## Retro Heuristic

> **Removed in v2.** The `epic-retro` helper and
> `lib/orchestration/retro-heuristics.js` (`isCleanManifest`) were deleted with
> the Epic delivery path; compact-vs-full retro branching no longer applies.
> Kept as a glossary for archived docs that still name the predicate.

| Term                       | Kind     | Definition                                                                                                                                                |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCleanManifest(signals)` | Predicate | *(deleted)* Formerly returned `true` iff friction/parked/recuts/hotfixes/hitl were all zero. |
| `--full-retro`             | CLI flag | *(deleted)* Former `/deliver` override forcing the six-section retro body. |
