---
name: structured-output-zod
description:
  Validates external and structured data with Zod schemas. Use when accepting
  untrusted input at API boundaries, validating environment variables on
  startup, parsing third-party responses, or generating typed shapes via
  `z.infer`. Parse, don't validate.
vendor: zod
---

# Skill: Structured Output (Zod)

Guidelines for ensuring system reliability through schema validation and typed
safety.

## 1. Core Principles

- **Schema First:** Always define data shapes with Zod before processing or
  storing external data.
- **Type Safety:** Leverage Zod's `z.infer` to automatically generate TypeScript
  types from your schemas.
- **Parse, Don't Validate:** Use `z.parse()` or `z.safeParse()` to transform
  untrusted input into trusted, typed objects.

## 2. Technical Standards

- **API Validation:** Validate every incoming request body and query parameter
  at the application boundary.
- **Environment Variables:** Use Zod to validate `process.env` on startup to
  fail fast if critical config is missing.
- **Database Schemas:** In systems like Drizzle or Turso collections, use Zod
  schemas to ensure data integrity during writes.

## 3. Best Practices

- **Error Messages:** Provide user-friendly, specific error messages via Zod's
  custom error formatting.
- **Composition:** Build complex schemas using `.extend()`, `.merge()`, and
  `.pick()` to maintain DRY principles in your types.
- **Coercion:** Use Zod coercion (`z.coerce.number()`) carefully to handle
  string inputs from forms or query parameters.
