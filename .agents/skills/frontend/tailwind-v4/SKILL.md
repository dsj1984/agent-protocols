# Skill: Tailwind CSS v4

Rules for implementing high-performance, maintainable styling using the latest
Tailwind CSS specification.

## 1. Core Principles

- **CSS-First Configuration:** Use CSS variables for theme customization rather
  than the `tailwind.config.ts` file where possible.
- **Modern Syntax:** Leverage the new `@theme` directive and fluid design
  utilities.
- **Token Consistency:** Strictly adhere to the design system's spacing, color,
  and typography tokens.

## 2. Technical Standards

- **Utility Usage:** Prefer atomic utility classes (`flex`, `p-4`, `text-lg`)
  over custom CSS classes.
- **Responsive Design:** Use mobile-first breakpoints (`sm:`, `md:`, `lg:`,
  `xl:`).
- **Interactive States:** Explicitly define `hover:`, `focus-visible:`, and
  `active:` states for all interactive elements to ensure a premium feel.
- **Arbitrary Values:** Avoid arbitrary values (`p-[13px]`) unless absolutely
  necessary for unique design elements; use standard spacing steps instead.

## 3. Best Practices

- **Class Ordering:** Use the standard Tailwind class ordering (Layout -> Box
  Model -> Typography -> Visual -> Misc).
- **Component Patterns:** For repeated UI patterns (e.g., buttons), use a
  dedicated component or a reusable `@apply` block in a CSS file to avoid
  class-string bloat.
- **Dynamic Classes:** Never use string interpolation to create utility classes
  (e.g., `text-${color}`). Always use full class names to ensure the compiler
  detects them.
