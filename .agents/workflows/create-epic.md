---
description: >-
  Takes a high-level goal, fleshes out a proper Epic title and description using LLM reasoning, and creates the Epic in GitHub.
---

# /create-epic

## Overview

This workflow is designed to streamline the creation of formal Epics. When given a high-level concept or goal, the agent will extrapolate a well-structured Epic title and a comprehensive description, and then programmatically create the Epic ticket in the project's GitHub repository.

## Step 1 — Formulate Title and Description

Based on the high-level goal provided by the user, draft the following items:

1. **Epic Title**: A clear, action-oriented title (e.g., "Implement Story-Level Branching and Execution Model").
2. **Body/Description**: A comprehensive overview of the goal. The format should be:
   - **Background & Context**: Why we are doing this.
   - **Core Objective**: The primary outcome.
   - **Scope / High-Level Requirements**: What needs to be done.
   
*(The agent should draft this internally leveraging its language model capabilities, no need to ask the user unless the goal is completely ambiguous).*

## Step 2 — Create the Epic Issue

Use the ticketing provider or GitHub MCP tool to create the issue in the target repository.

The issue **MUST** include:
- The formulated Title and Body.
- The label: `type::epic`.

For example, using the GitHub MCP server `issue_write` tool or the system's provider:

```javascript
// Example using the native provider
const { createProvider } = require('./.agents/scripts/lib/provider-factory.js');
const { resolveConfig } = require('./.agents/scripts/lib/config-resolver.js');

const { orchestration } = resolveConfig();
const provider = createProvider(orchestration);

const epic = await provider.createTicket(null, {
  title: "[Drafted Title]",
  body: "[Drafted Body]",
  labels: ["type::epic"]
});
console.log(`Epic Created: #${epic.id}`);
```

## Step 3 — Report Back

Inform the operator that the Epic has been successfully created, providing the following:
- The Epic ID (e.g., `#123`).
- The Epic Title.
- A link to the Epic, or a prompt to the operator to proceed with `/sprint-plan [Epic ID]`.

## Constraint

- Do not create duplicate Epics. If the user provides a goal that closely matches
  an existing open Epic, inform them and ask for confirmation before creating.
- The Epic body must be self-contained — it should provide enough context for the
  `/sprint-plan` pipeline to generate a meaningful PRD without additional input.
- If the high-level goal is complex or ambiguous, review the draft with the user
  before programmatic creation.
