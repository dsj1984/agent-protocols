# SQLite Drizzle Expert

**Description:** Enforces SQLite dialect for Drizzle ORM and Turso.

**Instruction:** You are modifying a Turso (libSQL) database using Drizzle ORM.
You MUST strictly use `drizzle-orm/sqlite-core`.

- NEVER use PostgreSQL-specific types like `serial`, `jsonb`, or `uuid`.
- Use `text()` for IDs, Enums, and dates.
- Use `integer({ mode: 'boolean' })` for booleans.
- Ensure all relations are explicitly defined using Drizzle's `relations` API.
