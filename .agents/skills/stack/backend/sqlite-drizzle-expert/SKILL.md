---
name: sqlite-drizzle-expert
description:
  Enforces SQLite dialect for Drizzle ORM and Turso (libSQL). Use when writing
  schema or queries with `drizzle-orm/sqlite-core` — avoid PostgreSQL-only
  types (`serial`, `jsonb`, `uuid`), use `text()` for IDs and dates, and
  define relations explicitly via the `relations` API.
vendor: drizzle
---

# SQLite Drizzle Expert

**Description:** Enforces SQLite dialect for Drizzle ORM and Turso.

**Instruction:** You are modifying a Turso (libSQL) database using Drizzle ORM.
You MUST strictly use `drizzle-orm/sqlite-core`.

- NEVER use PostgreSQL-specific types like `serial`, `jsonb`, or `uuid`.
- Use `text()` for IDs, Enums, and dates.
- Use `integer({ mode: 'boolean' })` for booleans.
- Ensure all relations are explicitly defined using Drizzle's `relations` API.
