---
description: Audit UX/UI consistency and design system adherence
---

# UX/UI & Design System Audit

## Role

Lead Product Designer & Frontend Architect

## Context & Objective

Evaluate the frontend implementation for UI consistency, UX best practices, and
adherence to the project's design system. Ensure the application feels premium
and cohesive.

## Step 1: Visual Consistency Check

Scan frontend components for:

- **Hardcoded Values:** Identify "magic" hex codes, font sizes, or spacing
  values that bypass the CSS variables/design tokens.
- **Component Re-implementation:** Find places where custom HTML/CSS is used
  instead of the standard component library (e.g., custom button instead of
  `<Button />`).
- **Interactive States:** Verify that all clickable elements have hover, focus,
  and active states.
- **Typography:** Ensure font families and weights are used consistently
  according to the hierarchy.

## Step 2: UX Best Practices

1. **Information Hierarchy:** Is the most important action/information
   prominent?
2. **Error States:** Are form errors clear and helpful, or generic and
   frustrating?
3. **Loading States:** Are there skeletons or spinners for async operations?
4. **Responsiveness:** Check layouts at mobile, tablet, and desktop breakpoints.
5. **Accessibility (UX-focused):** Focus on tab order, touch target sizes, and
   color contrast.

## Step 3: Output Requirements

Generate and save a report to `ux-ui-audit.md` in the project root.

```markdown
# UX/UI Audit Report

## Design System Health

[Score 1-10] - [Brief summary of adherence to tokens and components.]

## Visual Inconsistencies

- **[Issue Name]**: [Location] - [Description, e.g., "Using #ff0000 instead of
  var(--color-error)".]

## UX Improvements

### [Target Feature/Page]

- **Observation:** [What is confusing or broken for the user?]
- **Recommendation:** [Specific UI change to improve the experience.]

## Micro-animation Opportunities

- [Suggest 2-3 places where subtle transitions could enhance the "premium"
  feel.]
```

## Constraint

This is a **read-only** audit. Provide the critique and implementation
suggestions, but do not modify styles or components.
