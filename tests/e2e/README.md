# `tests/e2e/` — the real-binary tier

These suites do not import the code under test. They `npm pack` this
repository, `npm install` the tarball into a temp consumer, and drive the
shipped `mandrel` binary as a child process — the same artifact npm publishes,
through the same argv → dispatch → install → re-exec → disk round trip a user
gets. That is the whole point of the tier and also its entire cost.

## The tier

`tests/e2e/**` belongs to the **`e2e` runner tier** and to no other one
(`listTestFilesForTier` in
[`../../.agents/scripts/lib/test-tiers.js`](../../.agents/scripts/lib/test-tiers.js)):

```bash
npm run test:e2e     # this directory
npm test             # everything else — never these
```

`npm test`, `npm run test:quick` and `npm run test:integration` all exclude it.
Before Story #5111 these files sat in the default tier, so every pre-push hook
and every local iteration paid for a real `npm pack` plus real `npm install`
spawns — measured at 9.08 s wall / 8.06 s sys for `update-chain` alone — to
re-prove something that only changes when the release-shaped install path
changes. CI runs the tier as its own per-PR job (`e2e` in
[`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

**The coverage run still measures these files.** `FULL_TIER_GLOBS` is
deliberately a superset of the `full` tier: c8's `NODE_V8_COVERAGE` is
inherited by the real `mandrel` children these suites spawn, so dropping them
from `run-coverage.js` would deflate `bin/mandrel.js` and `lib/cli/update.js`
and red the coverage ratchet on code nobody touched. Leaving the default suite
is not leaving the measured surface.

## Rules for a suite in here

- **Install once per `describe`.** Seed one consumer at module load and hand
  each `it` a recursive copy (`fs.cpSync(seed, dir, { recursive: true,
  verbatimSymlinks: true })` — the default rewrites `node_modules/.bin` links
  to absolute paths pointing back into the shared seed). A per-test
  `npm install` of the same tarball reproduces a tree you already have, at the
  cost of a full resolve and write pass.
- **Let the seed install be the environment probe.** These suites install
  `--offline`, which needs a warm npm cache; a fresh CI runner fails with
  `ENOTCACHED`. Do not spend a separate `--dry-run` spawn asking whether the
  real install would work — run it, and treat its failure as the skip signal.
  Set the skip reason at **module load**: `it(..., { skip })` snapshots its
  options when `describe` runs its body, before any `before` hook fires.
- **Skip loudly, never silently.** A precondition this tier cannot satisfy
  (cold cache, no `node-pty` addon, no `gh` on PATH) is a documented skip with
  a reason string, and the contract it covers must still be covered by a unit
  or contract suite that needs none of that.
- **Bound every child.** A real binary that wedges must fail the test, not hang
  the job: every spawn carries a timeout that SIGKILLs it.
- **Reap everything.** Temp dirs come from `makeTempDir` and are removed in
  `afterEach` / `after`; loopback servers are closed the same way. The CI
  temp-hygiene bracket fails the build on a leak.
