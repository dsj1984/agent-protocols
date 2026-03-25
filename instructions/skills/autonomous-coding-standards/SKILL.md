# Autonomous Coding Standards (Anti-Laziness)

**Description:** Prevents destructive file overwrites and enforces strict
typing.

**Instruction:** You are writing code directly to the file system.

- NEVER use placeholder comments like `// ... existing code ...`,
  `/* rest of file */`, or `// implementation here`. You must output the ENTIRE
  file or the ENTIRE complete function so it can be safely written to disk.
- Remove unused imports and dead code before finalizing a file.
- NEVER use `any` or `@ts-ignore` in TypeScript. If a type is complex, define
  the interface properly.
- Always leave a blank newline at the end of every file.
