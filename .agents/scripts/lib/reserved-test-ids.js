/**
 * lib/reserved-test-ids.js — the framework's one declaration of which
 * Epic / Story ids are **synthetic** (Story #4892).
 *
 * The band `999000–999999` has been reserved for test fixtures since the
 * post-test temp reaper shipped, but it lived as a private regexp inside
 * `cleanup-repo-test-temp.js` (`/^epic-999\d{3}$/`) and nothing else could
 * consult it. Two independent surfaces need the same rule, and spelling it
 * twice is how they would drift:
 *
 *   1. **Write side.** A test that spawns a real CLI at the repository root
 *      inherits the real state directory, so its fixture telemetry can land
 *      in the operator's live `temp/` signals tree. The post-run guard in
 *      `check-test-temp-hygiene.js` fails the run when a stream file owned by
 *      a reserved id survives there.
 *   2. **Read side.** The retro composer renders the distinct Stories a
 *      friction bucket spans as recurrence evidence in a body that is filed
 *      as a real GitHub issue. A reserved id is synthetic by construction, so
 *      it can never be resolved to a real issue and must never be published
 *      as evidence (issue #4870 named `#999999` as a contributing Story).
 *
 * Deliberately dependency-free: the write side is a CLI guard and the read
 * side is a pure composer, so the shared rule must not drag config, fs, or
 * git resolution into either.
 */

/** First id in the reserved test-fixture band. */
const RESERVED_TEST_ID_MIN = 999000;

/** Last id in the reserved test-fixture band. */
const RESERVED_TEST_ID_MAX = 999999;

/**
 * Human-readable band, for guard failure messages that have to tell an
 * operator which ids they may not use for real work.
 */
export const RESERVED_TEST_ID_BAND = `${RESERVED_TEST_ID_MIN}–${RESERVED_TEST_ID_MAX}`;

/**
 * Is `id` inside the reserved test-fixture band?
 *
 * Exact-band membership, because this is the predicate the temp reaper and
 * the pollution guard share: both classify an on-disk directory that a test
 * created, and over-reaching (treating every large id as reserved) would let
 * one of them delete or condemn a directory the band never claimed.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export function isReservedTestId(id) {
  return (
    Number.isInteger(id) &&
    id >= RESERVED_TEST_ID_MIN &&
    id <= RESERVED_TEST_ID_MAX
  );
}

/**
 * May `id` be published as ticket evidence in operator-visible output?
 *
 * The floor is the reserved band, not the band itself: an id at or above
 * `RESERVED_TEST_ID_MIN` is synthetic by construction (the framework reserves
 * that space for fixtures, and no repository has minted that many issues), so
 * nothing at or beyond the floor can be resolved to a real issue. A
 * non-integer or non-positive id is not a ticket reference at all.
 *
 * This is a plausibility bound, not an existence probe: it is the strongest
 * statement a caller with no ticket-provider access can make, and it is what
 * keeps the invariant true at every call site instead of only where somebody
 * remembered to wire a probe.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export function isPublishableTicketId(id) {
  return Number.isInteger(id) && id > 0 && id < RESERVED_TEST_ID_MIN;
}
