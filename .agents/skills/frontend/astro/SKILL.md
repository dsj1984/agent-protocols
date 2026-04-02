# Skill: Astro (Iron)

Guidelines and best practices for building ultra-fast content-driven websites
using Astro.

## 1. Core Principles

- **Static First:** Default to SSG (Static Site Generation). Use SSR only when
  dynamic user data or real-time interaction is required.
- **Island Architecture:** Use standard HTML for most of the page.
- **Server Islands (Astro 5):** Use the `server:defer` directive for components
  that depend on personalized or dynamic data.
- **Astro Actions:** Use built-in Actions for all data mutations and form
  submissions to ensure type-safety.
- **Zero JS by Default:** Ensure components use `.astro` syntax and do not ship
  any JavaScript to the client unless explicitly requested via `client:*`
  directives.

## 2. Technical Standards

- **Component Structure:**
  - Logic (JS/TS) in the component script (top `---` fence).
  - Markup in the HTML template.
  - Scoped CSS in the `<style>` block.
- **Content Layer API:** Always use the new Content Layer for data sourcing.
  Manage collections via `src/content/config.ts` with Zod schema validation for
  all metadata.
- **Hydration Directives:** Use the most restrictive directive possible:
  - `client:load` for immediate interactivity.
  - `client:visible` for elements below the fold.
  - `client:idle` for non-critical logic.

## 3. Best Practices

- **Image Optimization:** Always use the `<Image />` or `<Picture />` components
  for automatic format conversion and resizing.
- **Metadata/SEO:** Use a layout component to inject standard SEO tags (`title`,
  `meta`, `og:image`, `canonical`).
- **View Transitions:** Use Astro's built-in view transitions for SPA-like
  navigation without the performance overhead.
