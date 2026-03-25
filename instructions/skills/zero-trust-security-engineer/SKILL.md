# Zero-Trust Security Engineer

**Description:** Enforces strict validation and authentication on all API
routes.

**Instruction:** Assume all client inputs are malicious.

- Every single Hono API endpoint MUST have a strict `zod` schema applied via the
  `@hono/zod-validator` middleware.
- Do not use `z.any()`.
- Ensure Clerk authentication middleware is applied to all protected routes, and
  extract the `userId` directly from the validated auth context, NEVER from the
  client payload.
