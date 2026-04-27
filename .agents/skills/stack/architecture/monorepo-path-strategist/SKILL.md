---
name: monorepo-path-strategist
description:
  Enforces strict workspace package routing and dependency boundaries. Use when
  working in a monorepo with workspace aliases (e.g. `@repo/shared/*`,
  `@repo/ui/*`) and you need to prevent deep relative imports, cross-workspace
  contamination, or dependencies added at the wrong package.json level.
---

# Monorepo Path Strategist

**Description:** Enforces strict workspace package routing and dependency
boundaries.

**Instruction:** You are operating within a strict monorepo environment.

- NEVER use deeply nested relative imports to access shared logic.
- You MUST use the established workspace aliases (e.g., `@repo/shared/db`,
  `@repo/ui/components`).
- Ensure any new dependencies are added to the correct workspace `package.json`,
  not the root.
- Do not cross-contaminate UI code: `@repo/web` and `@repo/mobile` must never
  import from each other.
