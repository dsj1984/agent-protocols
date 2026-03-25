---
description: Generate a Technical Specification from a PRD
---

# Architecture Review Workflow

## Role

Architect

## Context & Objective

Your objective is to map the PRD to the specific database and tech stack before
any code is written.

**Target Sprint:** `[SPRINT_NUMBER]` — The user should provide the sprint number
when executing this command.

## Step 1 - Context Retrieval

Read and analyze the following files:

1. `docs/sprints/sprint-[SPRINT_NUMBER]-prd.md`
1. `data-dictionary.md`
1. `architecture.md`

## Step 2 - Generate Technical Specification

Cross-reference the PRD with the Turso/Drizzle data dictionary and
Hono/Cloudflare architecture.

**STRICT RULE:** You MUST follow the structure defined in
`.agents/templates/technical-spec-template.md`.

Generate an explicit technical specification outlining:

1. Database Schema Changes (New tables or modifications in Drizzle)
1. Backend API Routes (Hono endpoints with Zod validation)
1. Core System Query Refactors & Security
1. Execution Guardrails

## Step 3 - Output Artifacts

Save the generated specification to
`docs/sprints/sprint-[SPRINT_NUMBER]-tech-spec.md`.
