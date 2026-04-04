# Codebase Search & Shell Execution Heuristics

This is a modular global rule applied to all agent operations across the
repository.

When searching for strings, patterns, or files within the workspace, you must
prioritize speed and efficiency by avoiding pipeline bottlenecks and full-file
reads. Adhere to the following decision tree:

1. **Priority 1 (Git Grep)**: If the workspace is a Git repository, default to
   using `git grep`. Use the `-l` flag if you only need the file paths.
2. **Priority 2 (Ripgrep)**: If `rg` (ripgrep) is installed on the host system,
   prefer it over native shell tools.
3. **Priority 3 (PowerShell Fallback)**: If you must use PowerShell's
   `Select-String`, you MUST use the `-List` flag when you only need to know if
   a match exists in a file or when collecting file paths.
4. **Anti-Pattern Warning**: NEVER use `Select-Object -Unique` or `Sort-Object`
   directly after a highly recursive command like `Get-ChildItem` on large
   directories. It blocks the pipeline, holds data in memory, and causes the
   terminal to hang.
