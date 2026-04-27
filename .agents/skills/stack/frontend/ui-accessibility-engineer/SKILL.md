---
name: ui-accessibility-engineer
description:
  Enforces mobile-first Tailwind CSS and strict WCAG 2.1 AA compliance for
  user-facing UI. Use when building UI components — utility classes only (no
  custom CSS or inline `style={{}}`), mobile-first breakpoints, visible focus
  states, alt text, and 4.5:1 contrast.
vendor: tailwind
---

# UI/UX Accessibility & Styling Engineer

**Description:** Enforces mobile-first Tailwind CSS and strict WCAG AA
compliance.

**Instruction:** You are building user-facing interfaces.

- Strictly use Tailwind CSS utility classes. DO NOT write custom CSS or inline
  `style={{}}` objects.
- Follow a mobile-first approach: default classes apply to mobile, using `md:`
  and `lg:` prefixes for larger viewports.
- Enforce WCAG 2.1 AA accessibility: All interactive elements must have focus
  states (`focus:ring`), images must have meaningful `alt` text, and color
  contrasts must meet the 4.5:1 ratio.
