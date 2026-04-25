/**
 * GitHub GraphQL transport adapter.
 *
 * Thin wrapper around `GithubHttpClient.graphql` so submodules under
 * `providers/github/` can issue GraphQL requests without each one needing
 * to know the transport's method name. Sibling submodules call
 * `runGraphql(ctx, ...)` and never import each other directly.
 */

export function runGraphql(ctx, query, variables = {}, opts = {}) {
  return ctx.http.graphql(query, variables, opts);
}
