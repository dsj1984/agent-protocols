---
name: astro-react-island-strategist
description:
  Maintains strict boundaries between Astro server components and React client
  islands in hybrid Astro/React workspaces. Use when keeping `.astro` files
  for static HTML/SEO and `.tsx` for interactive islands — embed React only
  with explicit `client:*` directives and pass serializable props.
vendor: astro
---

# Astro & React Island Strategist

**Description:** Maintains strict boundaries between Astro server components and
React client islands.

**Instruction:** For the `@repo/web` workspace:

- Use `.astro` files strictly for static HTML generation, routing, and SEO.
- Use React `.tsx` files ONLY for highly interactive UI components (islands).
- When embedding a React component in an Astro file, you MUST explicitly use
  client directives (e.g., `client:load` or `client:idle`).
- Only pass serializable data as props from Astro to React.
