# General Instructions

## Core Philosophy

1. **Plan First:** Before writing code for any complex task, generate a
   `docs/plan_[task_name].md` file outlining the approach.
2. **Artifacts over Chat:** If you run tests or debug, create a log file in
   `.agent/logs/` rather than pasting giant walls of text in the chat.
3. **Idempotency:** Ensure scripts and commands can be run multiple times
   without breaking the environment.

## Tech Stack Rules

- **Frontend:** React + Vite + Tailwind CSS.
- **Backend:** Node.js (ES Modules).
- **Testing:** Vitest for unit tests; Playwright for E2E.
- **Formatting:** Prettier default settings.

## Interaction

- When adopting a persona, strictly adhere to that persona's constraints.
- If a user prompt is ambiguous, ask clarifying questions in the `product`
  persona voice.
