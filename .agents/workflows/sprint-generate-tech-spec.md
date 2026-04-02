---
description: Generate a Technical Specification from a PRD
---

# Sprint Generate Tech Spec

## Role

Architect

## Context & Objective

Your objective is to map the PRD to the specific database and tech stack before
any code is written.

**Target Sprint:** `[SPRINT_NUMBER]` — The user should provide the sprint number
when executing this command.

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agents/config/config.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Context Retrieval

Read and analyze the following files:

1. `[SPRINT_ROOT]/prd.md`
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
1. **HITL Risk Assessment**: You MUST act as a **Semantic Classifier**. Evaluate
   your proposed technical plan against the `riskGates.heuristics` defined in
   `.agents/config/config.json`. If your plan involves any destructive
   mutations, structural anomalies, or logic that deviates significantly from
   the localized PRD intent, you MUST explicitly flag this and instruct the
   Project Manager to set `"requires_approval": true` for that task in the
   manifest.

## Step 3 - Output Artifacts

Save the generated specification to `[SPRINT_ROOT]/tech-spec.md`.

## Constraint

Adhere strictly to the templates and instructions provided.
