---
description:
  Archive stale architectural decisions and patterns to prune the Local RAG
  index.
---

# Automated Context Pruning (Gardener)

This workflow is used to maintain a pristine signal-to-noise ratio in the Local
RAG context index by identifying and archiving stale or superseded architectural
documentation.

## Step 0 - Path Resolution

1.  Identify the location of `docs/decisions.md` (ADRs), `docs/patterns.md`, and
    any other core context documentation mentioned in `instructions.md`.
2.  Ensure a directory `docs/archive/` exists; if not, create it.

## Step 1 - Content Analysis & Archiving

1. **Analyze Documentation**: Review `docs/decisions.md`, `docs/patterns.md`,
   and project-wide rules for entries marked as `Superseded`, `Deprecated`,
   `Obsolete`, or those that directly contradict the current project state.
2. **Extract Stale Content**: Remove the stale semantic blocks (including
   headers, context, and reasoning) from the active document.
3. **Archive Records**: Append the extracted blocks to
   `docs/archive/deprecated-decisions.md` or
   `docs/archive/deprecated-patterns.md` respectively.
4. **Append Metadata**: Prefix each archived entry with the current date and a
   "Reason for Archiving" (e.g., "Superseded by ADR-024").

## Step 2 - Index Rebuild

1. **Rebuild Context Index**: Trigger the context indexer to reflect the
   changes: `node .agents/scripts/context-indexer.js index`
2. **Verify Signal**: Confirm that the archived content is no longer part of the
   active context by performing a test search for terms unique to the pruned
   sections.

## Constraint

Maintain documentation integrity. Only archive fully superseded or obsolete
blocks. If a decision is partially valid, keep the active portion and update it
with a reference to the new ruling. NEVER delete historical context; always move
it to `docs/archive/` to ensure it remains available for manual lookup while
being invisible to the AI-native Local RAG.
