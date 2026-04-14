---
description: Commit all outstanding changes to Git.
---

# /commit-all [Message]

This workflow stages and commits all current changes in the repository.

## Steps

1. **Stage Changes**: Track all new, modified, and deleted files.

   ```powershell
   git add .
   ```

// turbo

1. **Commit**: Create a new commit with the provided message. If no message is
   provided, a generic timestamped message will be used.

   ```powershell
   git commit -m "[Message]"
   ```

1. **Verify**: Show the last commit to confirm success.

   ```powershell
   git log -1
   ```

## Troubleshooting

- If the commit fails due to a locked index, wait a few moments and try again.
- Ensure your `GITHUB_TOKEN` is correctly configured if hooks require network
  access.

## Constraint

If the commit fails due to husky checks like markdownlint, fix those explicitly
and try again rather than bypassing.

## ⚠️ Parallel Sprint Execution

Do **not** use this workflow from inside a parallel story-execution context
(`/sprint-execute #<storyId>`). `git add .` sweeps any untracked files in the
working tree, which in a shared working directory may belong to another agent.
In that context, follow the explicit-staging + branch-guard pattern documented
in `sprint-execute.md` Step 1.
