# Lifecycle event schemas

JSON Schemas for the two events a delivery run can append to its per-run
lifecycle ledger. `appendLedgerEvent`
(`lib/orchestration/lifecycle/emit-ledger-event.js`) validates every payload
against one of these before the write; a schema mismatch throws and nothing is
appended.

`ledger-record.schema.json` is the NDJSON record envelope
(`emitted | completed | failed`), not an event. Only `emitted` has a writer —
see the schema's own description for why the other two kinds remain.

**A schema belongs here only while code emits its event.** Story #4545 applied
that rule to the `epic.*` and `acceptance.reconcile.*` families; Story #5024
applied it to the remaining fifteen when it retired the lifecycle bus that had
been their only publish path. `tests/lifecycle/schema-registry.test.js` enforces
it in both directions, so a schema file for an event nobody emits fails the
suite rather than reading green.

Schemas are intentionally permissive (`additionalProperties: true`) on inner
objects whose shape is dictated by upstream tooling (e.g. `gh pr view` JSON).
The required-key set is the contract.

Full reference:
[`docs/LIFECYCLE.md`](https://github.com/dsj1984/mandrel/blob/main/docs/LIFECYCLE.md).
