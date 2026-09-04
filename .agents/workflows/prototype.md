---
description: >-
  Operator-invoked UI prototype pass. Discovers the consumer's design-system
  SSOT first, then — only after the operator confirms — writes exactly one
  self-contained HTML file under the gitignored workspace-root temp tree, so a
  layout can be reviewed before its UI acceptance criteria are authored.
---

# /prototype [what to prototype]

UI acceptance criteria are otherwise authored blind: "the dashboard shows the
active runs" says nothing about layout, density, or interaction, so delivery
resolves those by taste. `/prototype` puts a reviewable artifact in front of the
operator before the criteria are written.

**Operator-invoked only.** `/mandrel-plan` may report that a plan touches UI and that
this command exists; it must never run it. No workflow, gate, or script invokes
`/prototype` — the whole design rests on the operator asking for it.

## Procedure

### Step 0 — Discover the design-system SSOT (first, before anything is drawn)

You cannot prototype *in the project's visual language* until you have found the
language. Locate and read the consumer's sources of truth — the same set
[`/audit-ux-ui`](audit-ux-ui.md) Step 0 mandates:

- **Design tokens / theme** — a `tailwind.config.{js,ts}`, CSS custom properties
  (`:root { --color-*, --space-* }`), a `theme/` / `tokens/` /
  `design-system/` directory, or a CSS-in-JS theme object.
- **Component roster** — the shared component directory (`components/ui/**`, a
  published design-system package) that raw elements are expected to defer to.
- **Documented conventions** — `docs/style-guide.md`, plus `docs/web-routes.md`
  when the surface is a route, whenever they exist in the consumer checkout.

Report what you found — token names, the component roster, the style-guide rules
— and draw only against that discovered baseline. **No artifact is drawn until
this step has run.**

### Step 0a — When no design-system SSOT is discoverable

Report the absence explicitly, then emit a **low-fidelity frame**: boxes,
labels, and hierarchy, in the host's default typography with no colour system.
Do **not** invent a visual language. A prototype in a palette the project never
adopted reviews the invention rather than the layout, and the operator cannot
tell which of the two they are approving.

### Step 1 — Confirm before writing (**hard gate**)

Describe the layout you intend — surfaces, hierarchy, states, and which
discovered tokens and components it reuses — and **STOP**. Nothing is written to
disk until the operator confirms; never write silently. This is the disk-write
policy [`core/idea-refinement`](../skills/core/idea-refinement/SKILL.md) already
applies to its one-pager.

### Step 2 — Write exactly one self-contained HTML file

On confirm, write **exactly one** self-contained `.html` file — inline CSS, no
build step, no fetched external assets — under the **gitignored workspace-root
temp tree** (`temp/prototypes/<slug>.html`). One file, because a prototype is a
thing to look at, not a codebase to maintain; self-contained, because it has to
open from disk with no server and no install.

Report the path, and iterate in place on that same file.

### Step 3 — Optional: publish to a host

Host publishing is an **optional upgrade of that same file** and never the
artifact of record — the file under the temp tree stays authoritative. Publish
only when the operator asks, and keep the two identical by re-publishing the
file rather than editing a published copy.

### Step 4 — Carry the review through to the Story

The **default carry-through is a fold into the Story's `## Spec`.** Delivery
reads the Story body and never the temp tree, so a layout that exists only as a
temp artifact is a layout delivery cannot see. Record the reviewed decisions —
surfaces, hierarchy, states, and the named tokens and components — as contract
prose in `## Spec`, and turn the observable ones into UI acceptance criteria.

**Committing a prototype is opt-in, per Story.** Ask; never default to it. A
prototype is wrong the moment the real UI ships, and a repository with a
documentation-freshness gate already carries that failure mode.

## Constraint

- **Nothing reaches disk without a confirm.** Step 1 is a hard gate, not a
  courtesy.
- **One file, under the temp tree.** Never a second artifact, never outside the
  gitignored workspace-root temp tree, and never a committed prototype
  directory by default.
- **Never invoked automatically.** `/mandrel-plan` records the offer and proceeds with
  planning; no workflow, gate, or script may call this command.
- **Read-only over the codebase.** The prototype file is the only write. Do not
  edit application source, tokens, or components to make a prototype render.
- **Discovered baseline only.** No invented palette, type scale, or component
  vocabulary when the project defines none.

## See also

- [`/audit-ux-ui`](audit-ux-ui.md) — the same design-system SSOT discovery,
  applied as a review lens after the UI ships.
- [`/mandrel-plan`](mandrel-plan.md) — where the advisory `complexitySignals.uiSurface` offer
  surfaces. It names this command; it never runs it.
