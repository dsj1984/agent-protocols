# Project Coding Patterns & Established Conventions

This document formalizes the accepted boilerplate, design patterns, and library
combinations used across the broader repository. When building a new feature,
you **MUST** adhere strictly to the patterns listed below to prevent "creative
drift," monolithic functions, and inconsistent tech stack adoption.

---

## 🏗️ 1. Global Utilities

### A. Environment Variable Validation

Never access `process.env` directly in application code without validation.

```typescript
// ✅ YES: Use the Zod configuration validator
import { env } from '@repo/env';
const secretKey = env.STRIPE_SECRET_KEY;

// ❌ NO: Raw process.env access
const secretKey = process.env.STRIPE_SECRET_KEY; // Bad practice
```

### B. Error Handling API Shapes

Standardize error shape to help our mobile clients deserialize API errors
safely.

```typescript
// ✅ YES: Standardized RFC7807 problem details
return ctx.json(
  {
    error: 'Validation failed',
    code: 'ERR_VALIDATION',
    details: result.error.format(),
  },
  400,
);
```

---

## 🌐 2. Frontend React/Astro Guidelines

### A. Data Fetching

Avoid `useEffect` for asynchronous state management. Use **React Query** for all
remote data fetching to benefit from intelligent caching and invalidation loops.

### B. CSS Strategies

Use standard **Tailwind v4** classes exclusively. We do not use CSS Modules or
raw vanilla CSS files for component styling. Do not create new primary colors
without clearing them with the UI/UX team. Use `@theme` abstractions in
`layer.css`.

---

## 🗄️ 3. Backend & API Conventions

### A. Pagination Structure

Any endpoints that return lists MUST be paginated cursor-based using standard
`limit` and `cursor` query parameters. We never use offset/limit integer
pagination for infinite scrolls.

### B. Database Operations

- **Soft Deletion:** We never execute raw `DELETE FROM` commands in Turso.
  Always prefer setting the `archivedAt` timestamp.
- **Transactions:** Complex nested insertions must be wrapped entirely within a
  `db.transaction()` block.
