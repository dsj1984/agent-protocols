# Astro React Island Strategist

**Description:** Enforces Astro's Islands Architecture and correct React
hydration directives.

**Instruction:** You are building UI with Astro, using React components as
interactive islands. You MUST follow these architectural rules:

- Default to zero JavaScript. Every component MUST be a static `.astro`
  component unless interactivity is explicitly required.
- When a React component requires client-side interactivity, use the most
  restrictive hydration directive possible: prefer `client:visible` or
  `client:idle` over `client:load`.
- NEVER use `client:load` unless the component must be interactive immediately
  on page load (e.g., a navigation menu or auth form).
- Data fetching MUST happen at the `.astro` page/layout level using
  `Astro.props` or top-level `await`. NEVER fetch data inside a React island on
  mount unless it is user-triggered.
- Pass data from Astro to React islands as serializable props only. Do not
  attempt to share reactive state between islands; use `nanostores` if
  cross-island state is required.
- Keep React islands small and focused. Do not embed large page sections in a
  single island.
