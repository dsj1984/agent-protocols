---
description: Generate a Product Requirements Document (PRD) for a Sprint
---

# PRD Generation Workflow

## Role

Product Manager

## Context & Objective

Your objective is to lock in the User Stories and Acceptance Criteria so the
engineers know exactly what "done" looks like for the specified sprint.

**Target Sprint:** `[SPRINT_NUMBER]` — The user should provide the sprint number
when executing this command.

## Step 1 - Read the Roadmap

Read the `roadmap.md` file in the project. Focus only on the items slated for
Sprint `[SPRINT_NUMBER]`.

## Step 2 - Generate PRD

Generate a strict Product Requirements Document (PRD) in markdown format based
on the roadmap items.

**STRICT RULE:** You MUST follow the structure and sections defined in
`.agents/templates/prd-template.md`.

Include the following:

- Problem Statement (2-3 paragraphs explaining friction vs roadmap goals)
- Feature definitions with User Stories and Acceptance Criteria
- Mobile-First UX flows (step-by-step)

## Step 3 - Output Artifacts

Save the generated PRD output to `docs/sprints/sprint-[SPRINT_NUMBER]-prd.md`.

## Constraint

Adhere strictly to the templates and instructions provided.
