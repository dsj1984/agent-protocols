# Skill: Cloudflare Workers

Guidelines for building and deploying high-performance serverless logic at the
edge.

## 1. Core Principles

- **Edge First:** Run code as close to the user as possible.
- **Resource Constraints:** Be mindful of the 128MB memory limit and the strict
  CPU time limits (e.g., 5-50ms) for workers.
- **Cold Starts:** Workers have near-zero cold starts, but external resource
  initialization must be optimized.

## 2. Technical Standards

- **Routing:** Use `Wrangler` for configuration and local development.
- **Storage Integration:** Use `KV` for simple key-value needs, `R2` for object
  storage, and `D1` for relational data.
- **Fetch API:** Always use the standard Fetch API for outgoing network
  requests.
- **Security:** Use `wrangler secret` for environment variables and API keys.

## 3. Best Practices

- **Sub-requests:** Minimize the number of sub-requests per worker invocation to
  stay within limits.
- **Streaming:** Use the `TransformStream` API for processing large payloads
  without loading everything into memory.
- **Error Handling:** Implement robust global error handlers to prevent total
  worker failure on a single request error.
