---
description:
  Read the foundational planning and architecture files to gain full context for
  a Sprint.
---

# Sprint Gather Context

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agentrc.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Context Retrieval

When instructed to gather sprint context, you MUST balance full comprehension
with context-window limits by prioritizing semantic retrieval (Local RAG) over
reading large monolithic markdown files.

1. **Initialize the Context Index**: Ensure the context vector index is
   up-to-date by running `node [SCRIPTS_ROOT]/context-indexer.js index`
2. `roadmap.md`: Read this file to identify the specific features slated for the
   requested sprint.
3. `[SPRINT_ROOT]/prd.md` & `[SPRINT_ROOT]/tech-spec.md`: Read these fully as
   they contain the specific task logic for your immediate sprint.
4. **Semantic Retrieval for Core Context**: Do NOT read full global architecture
   files (`docs/architecture.md`, `docs/data-dictionary.md`,
   `[DOCS_ROOT]/decisions.md`, `[DOCS_ROOT]/patterns.md`) unless they are
   extremely small. Instead, query specifically for the schemas, patterns, and
   technologies mentioned in the tech-spec using:
   `node [SCRIPTS_ROOT]/context-indexer.js search "your specific query here"`

Once these files are read, summarize the core objectives internally (do not
output them to the user unless requested) and proceed with your core task.

## Constraint

You MUST read the PRD and Technical Spec in their entirety before generating any
code. Never rely on the playbook's task summary alone for business logic.
