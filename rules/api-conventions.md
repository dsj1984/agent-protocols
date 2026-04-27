# API & Endpoint Conventions

Rules for REST and GraphQL API surfaces in any project that consumes this
framework. This rule is the **single source of truth** for the response
envelope, validation-status taxonomy, HTTP status-code conventions, and
payload-naming conventions. The companion skill
[`core/api-and-interface-design`](../skills/core/api-and-interface-design/SKILL.md)
covers process — when to design first, how to validate at boundaries, how to
extend without breaking — and links back here for the canonical wording.

## Payload Formatting

- All JSON request and response keys MUST use `camelCase`.
- Endpoint URLs MUST use lowercase `kebab-case` (e.g., `/api/user-profiles`).
- Resource paths MUST use plural nouns and avoid verbs
  (e.g., `GET /api/tasks`, not `GET /api/getTasks`).
- Query parameter names MUST use `camelCase`
  (e.g., `?sortBy=createdAt&pageSize=20`).
- Boolean fields MUST use an `is`/`has`/`can` prefix
  (e.g., `isComplete`, `hasAttachments`).
- Enum values MUST use `UPPER_SNAKE_CASE` (e.g., `"IN_PROGRESS"`).

## Response Envelope

Every handled error response MUST follow this exact shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_SNAKE_CASE",
    "message": "Human-readable explanation of why it failed.",
    "details": { }
  }
}
```

- `success` is a literal `false` boolean. Successful responses MAY omit the
  envelope and return the resource directly, but MUST NOT return
  `success: false` on a 2xx status.
- `error.code` is a machine-readable identifier in `UPPER_SNAKE_CASE`
  (e.g., `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`).
- `error.message` is a human-readable single sentence. Never include stack
  traces, internal identifiers, or implementation details.
- `error.details` is OPTIONAL and carries structured context (e.g., a Zod
  flatten output, the conflicting field name). Omit when empty.

A single endpoint MUST NOT mix error shapes (e.g., throwing on one path and
returning `{ error }` on another). Pick one and apply it across the surface.

## HTTP Status Codes

Use the canonical mapping below. Do not invent project-specific codes.

| Code | Meaning                 | When to use                                            |
| ---- | ----------------------- | ------------------------------------------------------ |
| 200  | OK                      | Successful `GET`, `PUT`, `PATCH`, idempotent `DELETE`. |
| 201  | Created                 | Successful `POST` resulting in resource creation.      |
| 400  | Bad Request             | Validation failures (Zod issues, malformed payload).   |
| 401  | Unauthorized            | Missing or invalid auth tokens.                        |
| 403  | Forbidden               | Authenticated, but lacks role permission.              |
| 404  | Not Found               | Resource does not exist.                               |
| 409  | Conflict                | Duplicate resource, version mismatch, optimistic-lock. |
| 500  | Internal Server Error   | Unhandled exceptions. Never leak internal detail.      |

## Validation Status

Validation failures — including schema parse errors and required-field checks
— MUST return **400 Bad Request** with the response envelope above and
`error.code = "VALIDATION_ERROR"`. Schema-flattened field errors MAY be
attached via `error.details`.

Authorization failures (401, 403) take precedence over validation: if the
caller is not allowed to invoke the endpoint at all, return the auth status
without running validation.
