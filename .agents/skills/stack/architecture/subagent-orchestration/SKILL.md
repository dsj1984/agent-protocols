# Skill: Subagent Orchestration

Internal protocol for managing complex tasks through the creation and
coordination of subagents.

## 1. Core Principles

- **Task Isolation:** One objective per subagent. Do not overload a subagent
  with multiple unrelated tasks.
- **Minimal Context:** Provide only the necessary context (files, docs, specific
  goal) to keep the subagent focused and token-efficient.
- **Verification:** The main agent must always verify the subagent's output
  before incorporating it into the final solution.

## 2. Operation Standards

- **Handoffs:** When delegating, clearly state the expected return format (e.g.,
  "Return a JSON summary", "Provide a diff for file X").
- **Error Handling:** If a subagent fails or returns an ambiguous result,
  investigate the failure rather than retrying blindly.
- **Parallelism:** Use subagents to perform non-dependent tasks concurrently
  (e.g., auditing three different modules simultaneously).

## 3. Best Practices

- **State Sync:** Ensure the main agent's mental model remains the source of
  truth if multiple subagents modify the codebase.
- **Summarization:** Require subagents to provide a concise summary of their
  findings to prevent the main context window from being flooded.
