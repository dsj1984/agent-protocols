# Project Roadmap

This document outlines the strategic priorities, upcoming feature developments,
and future architectural evolution for the Agent Protocols framework.

> **Note:** Version history for v1.x through v4.x has been archived to
> [docs/CHANGELOG-v4.md](./CHANGELOG-v4.md).

## Guiding Principles

- **Framework Flexibility**: Avoid overengineering that creates rigid or
  restrictive protocols. The framework must remain lightweight enough to take
  advantage of native model and tool improvements (e.g., larger context windows,
  improved reasoning, new system capabilities).
- **Self-Contained Architecture**: Minimize or eliminate external dependencies.
  Core functionality should reside within the protocol itself to maximize
  portability and security.


## Future Horizons

### MCP-Native Tooling Layer

- **MCP Standardization:** Refactor the Context Hydrator, Dispatcher, and
  state-sync utilities into standardized local **Model Context Protocol (MCP)
  servers**, replacing brittle script execution with dynamic tool discovery.
  Platform-specific MCP servers (e.g., GitHub MCP) become first-class
  dependencies.

### Observability & Real-Time Telemetry

- **Automated Maintainability Scoring:** Integrate static code analysis tools
  via an MCP Server to provide real-time maintainability and security feedback
  as CI check annotations on PRs/MRs.

### Autonomous Quality Assurance

- **Event-Driven Headless CI/CD:** Containerize the agentic execution interface
  as a self-hosted CI runner (e.g., GitHub Actions runner, GitLab Runner).
  Agents asynchronously resolve broken pipelines and issue verified PRs without
  human initiation—triggered directly by webhook events.

### Multimodal Visual Verification

- **Concept:** Introduce native multimodal testing into the QA workflows. Equip
  agents with vision models to compare application rendering states against
  baseline mockups, posting visual diff screenshots as PR/MR review comments.
  This catches regressions that text-only DOM parsing misses.

### Autonomous Protocol Evolution

- **Concept:** Implement a self-healing protocol that analyzes execution
  friction logs (posted as ticket comments) to autonomously propose PRs that
  refine its own prompt specifications and routing logic based on real-world
  performance.

### Post-v5 Backlog (Under Consideration)

- **Complexity Estimator as Validation Pass:** The v4 `ComplexityEstimator.js`
  is removed in v5.0.0. If dogfooding reveals that the LLM-based decomposer
  produces over-complex Tasks, re-introduce complexity scoring as a validation
  pass inside `ticket-decomposer.js`.
