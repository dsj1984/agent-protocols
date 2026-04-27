# Context Engineering — Examples

Long examples extracted from `SKILL.md` so the skill stays focused on routing
and process. Treat the snippets here as illustrative starting points, not
prescriptive templates.

---

## Rules File: `CLAUDE.md` (Claude Code)

A representative rules file for a React/Vite/Postgres project. Adapt the
sections to the actual stack and conventions of your repo.

```markdown
# Project: [Name]

## Tech Stack

- React 18, TypeScript 5, Vite, Tailwind CSS 4
- Node.js 22, Express, PostgreSQL, Prisma

## Commands

- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint --fix`
- Dev: `npm run dev`
- Type check: `npx tsc --noEmit`

## Code Conventions

- Functional components with hooks (no class components)
- Named exports (no default exports)
- colocate tests next to source: `Button.tsx` → `Button.test.tsx`
- Use `cn()` utility for conditional classNames
- Error boundaries at route level

## Boundaries

- Never commit .env files or secrets
- Never add dependencies without checking bundle size impact
- Ask before modifying database schema
- Always run tests before committing

## Patterns

[One short example of a well-written component in your style]
```

### Equivalent files for other tools

- `.cursorrules` or `.cursor/rules/*.md` (Cursor)
- `.windsurfrules` (Windsurf)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `AGENTS.md` (OpenAI Codex)

The format differs but the contents (tech stack, commands, conventions,
boundaries, patterns) carry across all of them.
