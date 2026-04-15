---
description: >-
  Reconcile the project's .agentrc.json against .agents/default-agentrc.json by
  adding missing fields, removing obsolete fields, and preserving all existing
  values. Handles arbitrarily nested structures.
---

# /sync-agents-config

## Overview

This workflow performs a **structural diff-and-merge** between the
framework-provided template (`.agents/default-agentrc.json`) and the
project-local configuration (`.agentrc.json`) at the repository root. The goal
is to keep the project config schema-compatible with the current framework
version without losing any project-specific customizations.

The reconciliation rules are:

| Scenario                                     | Behavior                                |
| -------------------------------------------- | --------------------------------------- |
| Field present in default, missing in project | **Add** from default (with default val) |
| Field present in project, missing in default | **Remove** (treated as obsolete)        |
| Scalar/array in both                         | **Preserve** the project's value        |
| Object in both                               | **Recurse** into nested keys            |
| Entire nested object missing in project      | **Add** the whole subtree from default  |
| Entire nested object missing in default      | **Remove** the whole subtree            |

> **Persona**: `devops-engineer` · **Skills**: `core/ci-cd-and-automation`,
> `core/documentation-and-adrs`

## Step 0 — Resolve File Paths

1. `[DEFAULT_CONFIG]` → `.agents/default-agentrc.json`
2. `[PROJECT_CONFIG]` → `.agentrc.json` at the repository root

If `[DEFAULT_CONFIG]` is missing, abort — the framework submodule is not
initialized correctly. If `[PROJECT_CONFIG]` is missing, create it by copying
`[DEFAULT_CONFIG]` verbatim and skip to Step 4.

## Step 1 — Load Both Files

Parse both JSON files into memory. Preserve the top-level key ordering of
`[DEFAULT_CONFIG]` as the canonical order for the output.

If either file fails to parse (invalid JSON), abort and report the parse error
with file path and line number. Never attempt to silently "fix" malformed JSON.

## Step 2 — Perform Structural Merge

Apply the following recursive algorithm. Let `D` = default value, `P` = project
value for a given key at a given path.

```text
merge(D, P):
  if D is an object AND P is an object:
    result = {}
    for each key K in D (preserve D's order):
      if K in P:
        result[K] = merge(D[K], P[K])     # recurse
      else:
        result[K] = D[K]                   # add missing
    # Any key in P but not in D is implicitly dropped (obsolete)
    return result

  if D is an array AND P is an array:
    return P                               # preserve project array wholesale

  if D and P have different types (e.g. object vs string):
    return P                               # trust the project's override;
                                           # flag as a warning (see Step 3)

  # Both are scalars (string, number, boolean, null)
  return P                                 # preserve project value
```

### Key Semantics

- **Arrays are opaque values.** Do not attempt to merge array elements; the
  project's array is the authoritative value. This applies to
  `docsContextFiles`, `release.docs`, `riskGates.heuristics`,
  `models.categories`, etc. Operators who want new defaults must edit those
  arrays manually.
- **Nested objects expand fully** when absent in the project. For example, if
  `[PROJECT_CONFIG]` omits `techStack.database` entirely and the default
  includes it, copy the whole `database` subtree in. Conversely, if the default
  no longer has `techStack.workspaces` and the project does, remove it.
- **Type mismatches prefer the project value** (operator intent wins) but must
  be recorded in the summary so a human can review.
- **`$schema` and top-level metadata keys** (`title`) are treated the same as
  any other field: default wins if absent, project wins if present.

## Step 3 — Build the Change Report

While merging, collect a structured change log with one entry per modification:

```text
[ADDED]    <dot.path.to.field>           <value-preview>
[REMOVED]  <dot.path.to.field>           <previous-value-preview>
[TYPE]     <dot.path.to.field>           default=<type> project=<type>
```

- Truncate value previews to 80 characters.
- Group the report by operation (`ADDED`, `REMOVED`, `TYPE`).
- If the report is empty, the file is already in sync — skip Step 4 and emit a
  single "No changes required" line.

## Step 4 — Write the Reconciled Config

1. Serialize the merged object to JSON with **2-space indentation** and a
   trailing newline (matches the existing file's formatting).
2. Overwrite `[PROJECT_CONFIG]` atomically (write to a temp file in the same
   directory, then rename) so a crash mid-write cannot corrupt the config.
3. Re-parse the written file to confirm it is valid JSON before returning.

## Step 5 — Emit the Summary

Print the change report from Step 3 to stdout. Do **not** auto-commit the change
— the operator must review the diff first. Suggest the review command:

```powershell
git diff .agentrc.json
```

## Constraints

- **Never modify `[DEFAULT_CONFIG]`.** It is treated as read-only; the source of
  truth is the framework submodule.
- **Never invent values.** If a field is added from default, use the default's
  exact value — do not substitute project-specific guesses (e.g. do not rewrite
  `[OWNER]` placeholders to the detected git remote).
- **Preserve project overrides unconditionally.** Even if a project value looks
  "wrong" (empty string, zero, null), it is intentional and must survive the
  merge.
- **Idempotent.** Running this workflow twice back-to-back must produce no
  changes on the second run.
- **No partial writes.** If any step fails (parse error, write error), leave
  `[PROJECT_CONFIG]` untouched.
- **Do not auto-commit.** The operator is responsible for reviewing the diff and
  committing.
