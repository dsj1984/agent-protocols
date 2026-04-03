# Technical Specification: Sprint [SPRINT_NUMBER] - [SPRINT_NAME]

**Context:** This document outlines the explicit database schema migrations and
API route implementations required to fulfill the Sprint [SPRINT_NUMBER] PRD.
Read `.agents/config/tech-stack.json` to determine the project's ORM, API
framework, authentication middleware, validation library, and workspace paths.
Align all changes with `architecture.md`.

---

## 1. Database Schema Changes

### A. New Tables

(If applicable. If none, write "None required.")

**`[table_name]`** [Brief description of what this table stores]

- `id`: `text` (Primary Key, UUID)
- `[column_name]`: `[type]` (Constraints: e.g., Foreign Key, Default, Nullable)
- `created_at`: `text` (Default: current timestamp)

_Indexes:_ `[index_name]` on `([columns])` for [reason].

### B. Table Modifications

(If applicable. If none, write "None required.")

**`[existing_table_name]`**

- **ADD COLUMN:** `[column_name]` `[type]` (Enum/Constraints). Default:
  `[default_value]`.
- **ALTER INDEX:** [Details of index changes if necessary].

---

## 2. Backend API Routes

_All routes must be protected by the project's established authentication
middleware and validate payloads using the project's configured schema
validation library._

### A. [Domain Name] Routes (`/v1/[domain]`)

(If no new API logic is required, briefly summarize the unit tests or
restructuring needed, or write "None required.")

- **`[HTTP_METHOD] /v1/[endpoint]`**
  - **Body/Query:** `{ [expected_payload] }` (Validated via schema)
  - **Logic:** [Step-by-step explanation of the backend logic. E.g., "Verify
    user role -> Insert row into X -> Trigger notification -> Return 201"].
  - **Response:** `[HTTP Status Code]` + `{ [JSON_structure] }`

(Repeat for all necessary endpoints)

---

## 3. Core System Query Refactors & Security

_(Use this section to explicitly call out changes required to existing systems
to support the new features, preventing regression bugs.)_

### A. [System Name, e.g., Feed Aggregation or Omni-Search]

- **Logic Update:** [Explain how existing ORM queries need to be modified. E.g.,
  "Must inject a WHERE clause to filter out 'connections_only' posts for
  unauthorized users."]
- **Security Guardrails:** [Explicitly state any RBAC or privacy checks that
  must be enforced].

---

## 4. Execution Guardrails

1. Ensure all new validation schemas are exported from the project's shared
   schema package.
2. Run the project's schema generation/migration command to verify schema
   changes before pushing to the database.
3. Ensure all API endpoints return standardized JSON payloads matching the
   platform's error-handling signature as defined in
   `.agents/rules/api-conventions.md`.
