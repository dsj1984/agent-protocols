# Archived data-dictionary entries — 2026-08

Retired sections relocated out of
[`docs/data-dictionary.md`](../data-dictionary.md) by Story #4924, and
`FrictionEvent` by Story #4938. Each documents a surface the repository no
longer implements — its entire body was already a statement that the thing is
gone, so it defined no live vocabulary.

**Archived, not deleted.** The bodies below are word-for-word as they stood in
`docs/data-dictionary.md`. No prose was rewritten or summarized, beyond
`FrictionEvent`'s tense: its schema file still existed when it was written and
does not now.

**Nothing live was lifted out.** Each section's replacement surface was already
named inside it and is repeated in the one-line pointer left in the live doc.

| Section | Retired because |
| --- | --- |
| StoryPerfSummary / EpicPerfReport | Both payloads and their schemas were deleted with the execution-analysis surface (Story #4545). |
| Dispatch Manifest | Deleted with the Epic tier in v2.0.0; nothing writes it. |
| Health-Monitor Refresh Cadence | The `epic-run-progress` comment and its progress reporter went with the in-process epic-runner stratum (#3908 / PR #3936). |
| Retro Heuristic | The `epic-retro` helper and `retro-heuristics.js` were deleted with the Epic delivery path. |
| FrictionEvent (retired shape) | Superseded by `SignalEvent` in the Epic #4406 cutover; its schema file, which nothing compiled, was deleted in Story #4938. |

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

---

## FrictionEvent (retired shape)

**A live `friction` record is a `SignalEvent` with `kind: "friction"`** — see
`docs/data-dictionary.md`. `appendSignal` validates against
`signal-event.schema.json` (the only file `signal-validator.js` compiles), and
`diagnose-friction.js#buildFrictionSignal` is the producer.

`friction-event.schema.json` was the pre-cutover document from Epic #1030,
superseded by `signal-event.schema.json` in the Epic #4406 envelope cutover.
Story #4938 deleted the file: nothing loaded it, and a well-formed schema with
nothing behind it reads as an enforced contract — an `/audit-documentation`
lens graded a High finding against it on exactly that basis, and the finding
reached an acceptance criterion before a delivering worker caught it. The table
below is the whole surviving record of the retired shape, kept so the two are
never confused:

| Field      | Type                | Required | Description                                                            |
| ---------- | ------------------- | -------- | ---------------------------------------------------------------------- |
| `eventId`  | `uuid string`       | Yes      | Unique event identifier.                                               |
| `timestamp`| `ISO8601 date-time` | Yes      | When the event occurred. The live envelope's key is `ts`.               |
| `sprintId` | `string`            | Yes      | Epic identifier the event belongs to. The live envelope's key is `epicId`. |
| `category` | `enum`              | Yes      | One of `Prompt Ambiguity`, `Missing Skill`, `Incorrect Persona`, `Tool Limitation`, `Execution Error`. |
| `details`  | `string`            | Yes      | Specific error message or observation. The live envelope requires an **object** here. |
| `source`   | `object`            | No       | `{ tool?, command? }` — failed tool / command. The live envelope moved this to `emitter` and reuses `source` for the framework/consumer tag. |
| `context`  | `object`            | No       | `{ protocolFile?: string }` — relevant protocol file path.              |

`required` was exactly `["eventId", "timestamp", "sprintId", "category",
"details"]`. **`taskId` was not in it and was not a property of the retired
schema at all** — its `additionalProperties: false` rejected it outright. (The
live `SignalEvent` envelope does carry an optional `taskId`, always `null`
since the 2-tier hierarchy landed.)
