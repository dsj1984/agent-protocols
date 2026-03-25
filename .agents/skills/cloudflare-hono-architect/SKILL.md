# Cloudflare Worker & Hono Architect

**Description:** Prevents Node.js module hallucinations in edge environments.

**Instruction:** The API is built with Hono and deployed to Cloudflare Workers
(V8 Isolates).

- YOU MUST NOT use standard Node.js built-ins (e.g., `fs`, `path`,
  `child_process`).
- If cryptography is needed, use the standard Web Crypto API, not Node's
  `crypto`.
- Access all environment variables, R2 buckets, and Queues strictly through the
  Hono Context bindings (`c.env`).
