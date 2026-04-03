# Coding Style & Formatting

This is a modular global rule applied to all agent operations across the
repository.

## 1. Code Formatting

- Use Prettier for all formatting. Do not manually format code.
- Always run the project format command (e.g., `npm run format`) after making
  significant file changes to ensure compliance.

## 2. File Naming Conventions

- React components: `PascalCase.tsx`
- Utilities & Functions: `camelCase.ts`
- Constants: `UPPER_SNAKE_CASE` for global constant values.

## 3. General Practices

- Prefer strict typing over `any`.
- Break large functions into smaller modular components.
- Do not leave commented-out, unused code snippets in PRs or finalized
  deliverables.
