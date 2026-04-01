# Architecture Decision Records (ADRs)

This document tracks significant architectural decisions and technical rulings
made throughout the project's lifecycle. It provides historical context to help
future developers (and AI agents) understand _why_ certain approaches were
chosen.

---

## Example Record 1: Transition to Hono for API Layer

- **Date:** 2026-03-20
- **Status:** **Accepted**
- **Sprint:** Sprint 034

### Context

Our legacy Express.js backends were difficult to deploy consistently to edge
environments (like Cloudflare Workers), causing cold-start issues for mobile
users.

### Decision

We chose to migrate all `@repo/api` routes from Express.js to **Hono**. Hono is
specifically designed for edge performance and has excellent TypeScript
inference that seamlessly integrates with our Zod validation layers.

### Consequences

- **Positive:** Improved edge deployment compatibility and sub-10ms cold starts.
- **Negative:** Minor rewrite required for all existing middleware.
- **Agent Instruction:** Any new routes MUST be written using Hono. Do not use
  Express.js.

---

## Example Record 2: Centralized Seed Data Scripts

- **Date:** 2026-03-31
- **Status:** **Accepted**
- **Sprint:** Sprint 040

### Context

The monolithic `seed.ts` file in `@repo/shared/db` grew out of control (nearly
2,000 lines), causing Git conflicts when multiple agents tried to insert sample
test data for concurrent features.

### Decision

We refactored database seeding into a modular, domain-driven architecture. E.g.,
`seed/users.ts`, `seed/events.ts`. A central `runner.ts` context dictates the
execution order.

### Consequences

- **Positive:** Agents can now edit domain-specific seed files without race
  conditions.
- **Negative:** Slightly more complex setup logic.
- **Agent Instruction:** When writing seed data, do not modify `seed.ts`. Use
  the specific domain fixture file in the `db/fixtures/` directory.
