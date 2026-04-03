# Agentic Design System & Style Guide: KinetixID

**Notice to Autonomous Agents (Cursor, Copilot, Devin, etc.):** This document is
the absolute source of truth for layout generation, component styling, and UI
copywriting. You must enforce these constraints strictly. Do not hallucinate
generic SaaS boilerplate, default OS-based theme toggles, standard sports
clip-art, or arbitrary padding values.

---

## 1. Brand Nomenclature & Metadata Context

When generating boilerplate code, `<title>` tags, SEO metadata, or zero-state UI
screens, use the following verified nomenclature. Do not use generic
`Lorem Ipsum` or default placeholders.

- **Primary Platform Name:** `KinetixID` (Do not use KINETIXID or kinetixid in
  body copy).
- **B2C Tagline (Athletes/Parents):** "Your Stats are Verified. Your Highlights
  are Unmissable. Your Story is Yours."
- **Actionable Marketing Copy:** "The Athletic Resume That Never Stops Growing."
  | "Stop Searching for Highlights. Start Getting Discovered."
- **B2B Elevator Pitch (Club Directors):** "Digital Identity as a Service.
  Eliminate administrative friction through seamless integrations and
  AI-automated highlight workflows."

---

## 2. Contextual Routing & Dual-Mode Theming (CRITICAL)

**CRITICAL RULE:** Do not implement "Dark Mode" and "Light Mode" as a
user-controlled OS preference toggle (e.g., `@media (prefers-color-scheme)`).
Theming is strictly dictated by **route context and user role**.

### Dark Mode: "The Locker Room"

- **Target Routes:** `/athlete/*`, `/social/*`, `/locker-room`, `/feed`,
  `/player/*`
- **Persona:** Athletes, Fans, Social Users.
- **Aesthetic Goal:** Immersive, media-forward, cinematic. Native to Gen Z
  creator apps (like Discord or Overtime).
- **Core Colors:** Background: `#0F1115` (Deep Space) | Surface: `#1C1F26`
  (Graphite) | Primary Text: `#F8FAFC` (Off-White)

### Light Mode: "The Admin Desk"

- **Target Routes:** `/admin/*`, `/parent/*`, `/recruiter/*`, `/compliance/*`,
  `/dashboard`
- **Persona:** Parents, Recruiters, Club Directors.
- **Aesthetic Goal:** Clinical, highly organized, secure. Inspired by enterprise
  fintech (like Stripe or Plaid).
- **Core Colors:** Background: `#F8FAFC` (Frost) | Surface: `#FFFFFF` (Pure
  White) | Primary Text: `#0F1115` (Deep Space)

---

## 3. Verbal Identity & UI Copywriting Rules

UI language must contextually shift based on the active route. When generating
button text, placeholders, or system alerts, enforce the following state machine
logic:

1.  **Athlete Context (Dark Mode):**
    - **Tone:** Aspirational, dynamic, peer-to-peer, highly concise.
    - **Rule:** Avoid administrative or corporate jargon.
    - _DO:_ "Drop Your Latest Highlight", "Request Endorsement", "Sync Stats".
    - _DON'T:_ "Upload Video File", "Send Connection Request", "Submit Data".
2.  **Parent/Admin Context (Light Mode):**
    - **Tone:** Authoritative, transparent, deeply secure, supportive.
    - **Rule:** Establish absolute trust. Emphasize compliance.
    - _DO:_ "COPPA-Compliant Verification", "Secure Payment Gateway", "Approve
      Roster Updates".
    - _DON'T:_ "Verify Now!", "Add Card", "Required Stuff".
3.  **Recruiter Context (Light Mode):**
    - **Tone:** Analytical, objective, purely functional.
    - **Rule:** Remove all marketing fluff. Focus on data sorting and
      validation.
    - _DO:_ "Filter by Verified Metrics", "Export Secure Transcript", "View
      Progression Graph".

---

## 4. Complete Typography System

Typography carries the heavy lifting of the "Creator-Enterprise Hybrid"
architecture. Base sizing is calculated at `16px = 1rem`. **Agent Instruction:
Strictly use these exact `rem` values, weights, line heights (leading), and
letter spacing (tracking).**

### 4.1 Font Families

- **Primary Display:** `Space Grotesk`, fallback:
  `Afacad, system-ui, sans-serif` (Google Fonts). Used for high-impact
  marketing, team hub titles, dynamic digital player cards, and prominent UI
  numbers.
- **Secondary UI / Body:** `Inter`, fallback: `system-ui, sans-serif` (Google
  Fonts). Used for all body text, dense player statistics, verified roster
  tables, academic transcripts, compliance dashboards, and microcopy.

### 4.2 Comprehensive Typographic Scale

| Element          | Font Family   | Size (rem/px)      | Line Height | Weight         | Tracking  | Context Usage                                   |
| :--------------- | :------------ | :----------------- | :---------- | :------------- | :-------- | :---------------------------------------------- |
| **H1 Display**   | Space Grotesk | `3.50rem` (56px)   | `1.1`       | Bold (700)     | `-0.02em` | Marketing heroes, massive zero-state text.      |
| **H2 Header**    | Space Grotesk | `2.50rem` (40px)   | `1.2`       | SemiBold (600) | `-0.01em` | Main page headers, Player Card Names.           |
| **H3 Title**     | Space Grotesk | `1.75rem` (28px)   | `1.2`       | SemiBold (600) | `normal`  | Dashboard section titles, widgets.              |
| **H4 Subtitle**  | Inter         | `1.25rem` (20px)   | `1.3`       | SemiBold (600) | `normal`  | Modal headers, complex form groups.             |
| **H5 / H6**      | Inter         | `1.125rem` (18px)  | `1.4`       | Medium (500)   | `normal`  | Minor component sections.                       |
| **Body Large**   | Inter         | `1.125rem` (18px)  | `1.6`       | Regular (400)  | `normal`  | Article intros, emphasized body text.           |
| **Body Base**    | Inter         | `1.00rem` (16px)   | `1.5`       | Regular (400)  | `normal`  | Default UI text, standard paragraph copy.       |
| **Body Small**   | Inter         | `0.875rem` (14px)  | `1.4`       | Medium (500)   | `normal`  | Form labels, secondary descriptions, nav links. |
| **Micro / Data** | Inter         | `0.6875rem` (11px) | `1.3`       | SemiBold (600) | `0.04em`  | Table headers (Uppercase), timestamps, badges.  |

---

## 5. Multi-Tenant White-Labeling (WaaS) & Color Architecture

### 5.1 White-Labeling Rules (CSS Variables)

The platform UI must operate as a neutral canvas to support multi-tenant
white-labeling.

- **Agent Instruction:** Do **NOT** hardcode the platform's `Hyper-Violet` into
  generic UI components (buttons, active tabs, localized team headers) unless
  specifically building an unauthenticated global KinetixID landing page.
- Instead, utilize semantic CSS variables: `var(--waas-tenant-primary)` and
  `var(--waas-tenant-secondary)`.

### 5.2 Platform Global Palette (Fallback / Brand)

- **Hyper-Violet (Vibrant):** `#9333EA`
- **Hyper-Violet (Dark):** `#6B21A8`

### 5.3 Functional Accent Colors (Highly Restricted)

Never allow White-Label settings to override these functional colors.

- **Electric Cyan:** `#06B6D4` (Action/Verification: Verified badges, primary
  system CTAs).
- **Neon Lime:** `#10B981` (Progression: Success states, athletic metric
  increases).
- **Alert Coral:** `#F43F5E` (Urgency: Destructive actions, system errors,
  compliance failures).

### 5.4 Strict Accessibility Constraints (WCAG 2.1 AA)

- **Rule:** All text-to-background pairings must pass a minimum 4.5:1 contrast
  ratio.
- **Constraint Handling:** Electric Cyan (`#06B6D4`) and Neon Lime (`#10B981`)
  are too bright for white text. You **MUST** map Deep Space (`#0F1115`) as the
  text color when overlaying copy on these functional accent colors. Alert Coral
  (`#F43F5E`) must use Pure White (`#FFFFFF`) text.

---

## 6. Spatial Architecture & Layout Configurations

Do not hallucinate padding or margins. Build structural layouts using a strict
base-8 grid system.

### 6.1 Spacing Grid (Tailwind Equivalent)

- `space-1`: `0.25rem` (4px) — Micro spacing (icon to text)
- `space-2`: `0.5rem` (8px) — Inner component padding
- `space-4`: `1.0rem` (16px) — Standard container padding
- `space-6`: `1.5rem` (24px)
- `space-8`: `2.0rem` (32px) — Standard section gaps
- `space-12`: `3.0rem` (48px)
- `space-16`: `4.0rem` (64px) — Major layout/Hero gaps

### 6.2 Border Radii Contextual Logic

- `radius-sm`: `0.25rem` (4px) — Apply to Light Mode (Admin/Recruiter) elements
  like dense tables, input fields, and checkboxes to enforce a clinical fintech
  aesthetic.
- `radius-md`: `0.5rem` (8px) — Standard UI buttons, dropdowns, generic cards.
- `radius-lg`: `1.0rem` (16px) — Apply to Dark Mode (Athlete/Social) elements
  like media cards, highlight video containers, and primary content wrappers to
  enforce a modern creator aesthetic.
- `radius-full`: `9999px` — Pill shapes for status badges and circular avatars.

---

## 7. Iconography Constraints

- **Mandatory Library:** Exclusively utilize the **Lucide React** (or Phosphor)
  icon library.
- **Rule:** Do not use FontAwesome, HeroIcons, or unverified standard SVGs.
- **Anti-Cliché Rule:** Do not use literal sports clip-art (e.g., whistles,
  soccer balls, clipboards, human silhouettes in motion).
- **Style Standards:** Standardize all icons to an outline-only `1.5px` stroke
  weight. Use base sizes of `20px` for UI components or `24px` for Nav/Header
  elements.
- **Permitted Concepts:** Use abstract, geometric representations (e.g.,
  `<Network />` or `<Share2 />` for connections, `<ShieldCheck />` for
  verification, `<Activity />` for stats).

---

## 8. Agentic Design Tokens (`tokens.json`)

Use this strict token payload for systematic programmatic generation, Tailwind
configurations, or Style Dictionary mapping.

```json
{
  "kinetix": {
    "brand": {
      "color": {
        "primaryVibrant": { "value": "#9333EA", "type": "color" },
        "primaryDark": { "value": "#6B21A8", "type": "color" }
      }
    },
    ...
  }
}
```
