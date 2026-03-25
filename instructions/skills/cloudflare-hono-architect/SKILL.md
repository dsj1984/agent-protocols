# Cloudflare Hono Architect

**Description:** Enforces idiomatic Hono patterns for Cloudflare Workers APIs.

**Instruction:** You are building or modifying a REST API using the Hono
framework deployed on Cloudflare Workers. You MUST follow these architectural
rules:

- ALWAYS use Hono's `app.route()` to compose modular sub-routers; never define
  all routes in a single file.
- Use Hono's built-in `validator` middleware with `zod` for all request
  validation at the route level.
- NEVER use Node.js-specific APIs (`fs`, `path`, `process`, etc.). Target the
  Web Platform API surface only.
- Access secrets and environment bindings exclusively via the `c.env` context
  object; never use global variables.
- Return structured JSON error responses using
  `c.json({ error: string, code: string }, statusCode)` consistently.
- Use `hono/bearer-auth` or a custom middleware for all authenticated routes;
  never inline auth logic in handlers.
