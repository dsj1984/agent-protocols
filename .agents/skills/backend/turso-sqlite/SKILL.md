# Skill: Turso (SQLite)

Rules for developing with Turso's distributed SQLite database platform.

## 1. Core Principles

- **Edge Efficiency:** Leverage Turso's low-latency distribution for edge
  applications.
- **SQLite Simplicity:** Use standard SQL syntax. SQLite is powerful—don't
  over-engineer with complex ORMs unless necessary.
- **Replication:** Understand the primary/replica architecture for
  geographically distributed workloads.

## 2. Technical Standards

- **Driver Usage:** Use the `@libsql/client` driver for all database operations.
- **Parameterized Queries:** Never use string interpolation for queries. Always
  use placeholders (`?` or `:name`) to prevent SQL injection.
- **Migrations:** Use a structured migration tool (e.g., `drizzle-kit` or
  `atlas`) to manage schema changes versioned in git.

## 3. Best Practices

- **Connection Management:** Reuse database client instances within a worker
  invocation to minimize handshake overhead.
- **Read-Local, Write-Primary:** Direct read operations to the nearest replica
  and write operations to the primary instance.
- **Profiling:** Use `EXPLAIN QUERY PLAN` to audit slow queries and ensure
  proper indexing of large tables.
