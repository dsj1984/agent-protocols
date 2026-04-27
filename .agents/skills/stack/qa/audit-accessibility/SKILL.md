---
name: audit-accessibility
description:
  Audits sites and apps for WCAG 2.1 Level AA compliance using automated and
  manual testing tools. Use when running an accessibility audit or building a
  remediation plan — semantic HTML, contrast, focus management, keyboard
  reachability, and axe-core integration in Vitest/Playwright.
---

# Skill: Accessibility Audit (A11y)

Protocols for ensuring WCAG 2.1 Level AA compliance using automated and manual
testing tools.

## 1. Core Principles

- **Inclusive Design:** The application must be usable by everyone, regardless
  of disability.
- **Automated First, Not Only:** Use tools to catch 40-50% of issues, then
  follow with manual keyboard and screen reader checks.

## 2. Technical Standards

- **Semantic HTML:** Use correct tags (e.g., `<nav>`, `<main>`, `<header>`,
  `<button>`) to provide native accessibility features.
- **Contrast Ratios:** Maintain a minimum 4.5:1 contrast for normal text and 3:1
  for large text.
- **Focus Management:** Ensure a visible focus indicator is always present and
  the tab order is logical.
- **ARIA Labels:** Use `aria-label`, `aria-labelledby`, and `aria-describedby`
  only when standard HTML is insufficient.

## 3. Best Practices

- **pa11y/axe:** Integrate `axe-core` into Vitest/Playwright tests for automated
  regressions.
- **Alt Text:** Every image must have an `alt` attribute (empty for decorative
  images, descriptive for functional ones).
- **Keyboard Navigation:** Every interactive element must be reachable and
  triggerable via keyboard alone.
