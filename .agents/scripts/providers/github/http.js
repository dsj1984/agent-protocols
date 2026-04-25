/**
 * GitHub HTTP transport — REST request helpers.
 *
 * Owns the low-level GitHub REST transport: token-bearing headers, retry/
 * backoff, pagination, and URL construction. The `GithubHttpClient` class
 * implementation lives at `providers/github-http-client.js` so the historical
 * import path (and its dedicated test file) keeps working byte-identical.
 *
 * Submodules under `providers/github/` consume this transport via
 * `ctx.http.{rest,restPaginated}` — they never reach for a sibling submodule.
 */

export { GithubHttpClient } from '../github-http-client.js';
