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
2. **Commit**: Create a new commit with the provided message. If no message is provided, a generic timestamped message will be used.

   ```powershell
   git commit --no-verify -m "[Message]"
   ```

3. **Verify**: Show the last commit to confirm success.

   ```powershell
   git log -1
   ```

## Troubleshooting

- If the commit fails due to a locked index, wait a few moments and try again.
- Ensure your `GITHUB_TOKEN` is correctly configured if hooks require network access.
