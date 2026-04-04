# Technical Specification: Sprint 045 - Notification Customization & Global Discovery

**Context:** This document outlines the explicit database schema migrations and
API route implementations required to fulfill the Sprint 045 PRD. Read
`.agents/config/tech-stack.json` to determine the project's ORM, API framework,
authentication middleware, validation library, and workspace paths. Align all
changes with `architecture.md`.

---

## 1. Database Schema Changes

### A. New Tables

None required.

### B. Table Modifications

**`users`**

- **ADD COLUMN:** `notification_preferences` `text` (JSON string). Default:
  `'{"events":{"push":true,"email":true,"sms":false},"social":{"push":true,"email":true,"sms":false},"security":{"push":true,"email":true,"sms":true},"marketing":{"push":false,"email":true,"sms":false}}'`.
  - _Reasoning:_ A JSON column on the `users` table is lightweight and fits the
    existing pattern (e.g., `privacy_settings`, `physical_metadata`). It avoids
    unnecessary JOINs when the notification service needs to evaluate dispatch
    preferences for a user.

---

## 2. Backend API Routes

_All routes must be protected by the project's established authentication
middleware and validate payloads using the project's configured schema
validation library (Zod)._

### A. Users Routes (`/v1/users`)

- **`GET /v1/users/me/notifications`**
  - **Logic:** Retrieve the `notification_preferences` JSON string from the
    currently authenticated user's record.
  - **Response:** `200 OK` + `{ notificationPreferences: { ... } }`

- **`PATCH /v1/users/me/notifications`**
  - **Body/Query:** `{ preferences: NotificationPreferencesSchema }` (Validated
    via Zod schema exporting { events, social, security, marketing } each with {
    push, email, sms } boolean flags).
  - **Logic:**
    1. Parse incoming updates.
    2. Enforce constraint: `security` channel preferences (specifically email)
       cannot be disabled. Return a 400 if attempted.
    3. Merge existing JSON with new preferences.
    4. Execute Drizzle
       `UPDATE users SET notification_preferences = ? WHERE id = ?`.
  - **Response:** `200 OK` +
    `{ success: true, notificationPreferences: { ... } }`

### B. Directory Routes (`/v1/directory`)

- **`GET /v1/directory/athletes`** (Update existing)
  - **Query:** Add Zod-validated query params for `graduationYear` (using
    `academic_profiles.graduation_year`), `gpa` (using `academic_profiles.gpa`),
    and `position` (using `rosters.position_or_event` and
    `users.physical_metadata`).
  - **Logic:** Enhance the existing athlete directory query builder to
    dynamically append `WHERE` and `JOIN` clauses for `academic_profiles` when
    GPA or grad year filters are applied.
  - **Response:** `200 OK` + `{ data: [...], nextCursor: ... }`

- **`GET /v1/directory/clubs`**
  - **Query:**
    `{ state?: string, region?: string, tier?: string, limit: number, cursor?: string }`
  - **Logic:** Query the `clubs` table. Apply geographic filtering (by joining
    related `venues` or adding bounding box logic if region is provided, though
    usually `clubs` has a regional anchor or address field implied; if not, use
    `custom_domain` NOT NULL as a WaaS badge indicator).
  - **Response:** `200 OK` + `{ data: [...], nextCursor: ... }`

- **`GET /v1/directory/teams`**
  - **Query:**
    `{ sport?: string, gender?: string, ageGroup?: string, limit: number, cursor?: string }`
  - **Logic:** Query the `teams` table. Support faceted filtering by sport, age
    cohort, and gender category.
  - **Response:** `200 OK` + `{ data: [...], nextCursor: ... }`

---

## 3. Core System Query Refactors & Security

### A. Notification Dispatch Engine

- **Logic Update:** Refactor the existing notification dispatch utilities (e.g.,
  `sendPushNotification`, `sendEmail`) used by events, social relationships, and
  background CRONs. They must now read `users.notification_preferences`
  (preferably passed down from the caller who queried the user, or retrieved
  from a lightweight cache) and conditionally suppress dispatch if the boolean
  flag for the event's archetype (e.g., `events`, `social`) and channel (`push`,
  `sms`) is `false`.
- **Security Guardrails:** Security alerts (password resets, suspicious logins)
  must forcibly bypass the preference check and always dispatch to ensure strict
  account safety.

### B. Omni-Directory Privacy

- **Security Guardrails:** When resolving the `GET /v1/directory/athletes`
  endpoints and returning `academic_profiles` or PII data, the response mapped
  through Drizzle must enforce existing privacy constraints (e.g., checking
  `recruiter_data_visibility` and verifying the caller has a `recruiter` role).

---

## 4. Execution Guardrails

1. Ensure all new validation schemas (e.g., `NotificationPreferencesSchema`,
   `ClubDirectoryQuerySchema`) are exported from `@repo/shared/schemas`.
2. Run the Drizzle DB migration generation command
   `pnpm --filter @repo/shared db:generate` to verify the schema updates to the
   `users` table before pushing to the Turso database.
3. Ensure all API endpoints return standardized JSON payloads matching the
   platform's error-handling signature as defined in
   `.agents/rules/api-conventions.md`.

---

## 5. HITL Risk Assessment

**Semantic Classifier Evaluation:**

- There are no destructive data mutations or irreversible schema drops.
- Adding a lightweight JSON column (`notification_preferences`) to the `users`
  table is structurally safe.
- Updating the notification dispatch engine is central but straightforwardly
  non-destructive (preventing rather than creating actions).

**Conclusion:** **Risk Level:** Low. **Requires Approval:** `false`. No explicit
`"requires_approval": true` needed in the task manifest.
