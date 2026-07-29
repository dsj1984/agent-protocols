# Known Tooling Behavior

This rule applies when you are about to trust the output of a gate, a
baseline ratchet, or a local stand-in for a CI check — before pushing,
before declaring a check green, and before diagnosing a red one.

Each entry below records a **measured** behavior of this repository's own
tooling: a place where a command's visible output does not mean what it
looks like it means. Entries exist because each one has already cost a
delivery cycle.

## The entry bar

- An entry states behavior that was **measured against this repo**, never
  recalled and never assumed.
- Every entry carries a **reproduction command** that was actually run. If
  the command stops reproducing the behavior, **delete the entry** — do not
  annotate it. A stale entry is worse than a missing one, because it is
  trusted.
- Entries describe the observable behavior and the safe move. They never
  describe a way to bypass a gate, and recording a behavior here is not a
  decision to keep it.

## 1. `npm run lint` prints `Summary: 0 error(s)` and can still exit 1

**Behavior.** `npm run lint` is `run-lint.js`, which spawns six tools
concurrently with inherited stdio and exits with the first non-zero code.
`Summary: 0 error(s)` is **markdownlint-cli2's own verdict**, not the
aggregate — it is printed whether or not Biome, the lifecycle lint, the
workflow-CLI lint, the label-vocabulary lint, or the arch-cycle ratchet
failed. Because the tools run in parallel, that line can land anywhere in
the output, including last, so the tail of a failing run reads green.
Biome's format diagnostics are `error`-severity, so a file that only needs
reformatting fails the check while emitting no lint rule name at all.

**Reproduce.**

```bash
# a format-only diff is an error, not a warning
printf 'export const x = {a:1,   b:2};\n' | npx biome check --stdin-file-path=probe.js
echo "biome exit=$?"   # 1 — "The contents aren't fixed"

# and markdownlint's Summary line is unconditional
npm run lint 2>&1 | grep -c 'Summary: 0 error(s)'
```

**Safe move.** Trust the exit code, never the last line. When `npm run lint`
exits non-zero and you cannot see why, re-run `npx biome ci .` on its own —
`.agents/scripts/run-lint.js` lists every tool it fans out to. Fix formatting
with `npm run format`; never reach for `--no-verify`.

## 2. `check-baselines.js` is not the whole `baselines` check

**Behavior.** `.agentrc.json` declares the `baselines` required check as
`node .agents/scripts/check-baselines.js`, but that script only runs the
gates configured under `delivery.quality.gates` — currently **crap,
maintainability, and duplication**. CI's job named `baselines` in
`.github/workflows/ci.yml` runs that script **and then five standalone
ratchets** the script knows nothing about, so a locally green
`check-baselines.js` is not evidence that the `baselines` check will pass.

| Ratchet CI's `baselines` job runs | Covered by `check-baselines.js` | Covered by `npm run lint` | Covered by `npm run verify` |
| --- | --- | --- | --- |
| `.agents/scripts/check-arch-cycles.js` | no | **yes** | via `lint` |
| `.agents/scripts/check-dead-exports.js` | no | no | **yes** |
| `.agents/scripts/check-dead-exports.js --production` | no | no | **yes** |
| `.agents/scripts/check-context-budget.js` | no | no | **yes** |
| `.agents/scripts/check-workflow-citations.js` | no | no | **no** |

`check-workflow-citations.js` is currently in **no** local aggregate command
— it is reachable only as `npm run check:workflow-citations` or a direct
invocation.

**Reproduce.**

```bash
node .agents/scripts/check-baselines.js --format text   # names the 3 gates it ran
sed -n '/name: baselines/,/windows-smoke/p' .github/workflows/ci.yml | grep 'check-'
grep "label: '" .agents/scripts/run-verify.js            # the 7 steps verify covers
```

**Safe move.** `npm run verify` is the closest local mirror; run
`node .agents/scripts/check-workflow-citations.js` alongside it when the
change touches workflow prose under `.agents/workflows/`. Reproducing only
the `.agentrc.json` command before a push is a false green.

## 3. The two dead-export passes disagree, and the production pass is silent without `!`

**Behavior.** `check-dead-exports.js` runs twice with two separate
baselines. The default pass treats `tests/**` as knip entry points, so an
export whose only importer is a test still reads as *used*; the
`--production` pass discounts test importers and therefore sees a much
larger surface — `baselines/dead-exports.json` carries 165 rows against
`baselines/dead-exports-production.json`'s 667. A new export that is only
imported by its test passes the default pass and fails the production one.

The production pass depends entirely on the `!` suffix on the `entry` and
`project` patterns in `knip.json`: `!` marks a pattern as
production-relevant. Strip the suffixes and `knip --production` reports
**zero** export rows and exits clean — a green that means "nothing was
analyzed", not "nothing is dead".

**Reproduce.**

```bash
node .agents/scripts/check-dead-exports.js              # default pass
node .agents/scripts/check-dead-exports.js --production # strictly larger row set
grep -c '!"' knip.json                                  # the production markers
```

**Safe move.** Run both passes before pushing. When an export is genuinely
test-only, keep it and refresh the production baseline deliberately —
`.agents/rules/test-seams.md` governs which seams are sanctioned. Never
remove the `!` suffixes from `knip.json` to quieten the production pass.
