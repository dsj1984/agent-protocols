# Friction Logging Protocol

This document defines the structured format and procedures for logging friction events during agentic sprints. Friction logs are the primary data source for the autonomous protocol refinement system.

## Data Model (FrictionEvent)

Friction events are logged as structured JSON objects within GitHub issue comments. The schema is defined in [friction-event.schema.json](../.agents/schemas/friction-event.schema.json).

### Categories

| Category | Description |
| :--- | :--- |
| **Prompt Ambiguity** | The agent misunderstood the task requirements or protocol instructions. |
| **Missing Skill** | The agent lacks a specific capability or workflow required for the task. |
| **Incorrect Persona** | The assigned persona is not optimal for the task's domain. |
| **Tool Limitation** | An MCP tool or shell command failed due to architectural or environmental constraints. |
| **Execution Error** | A generic failure occurred that doesn't fit into the above categories. |

## Logging Procedure

Friction events are automatically captured by the `diagnose-friction.js` script when a command fails or when the agent identifies a loop/stagnation state.

### Format

Logs must be wrapped in a specific markdown block to be recognized by the aggregator:

```json
{
  "eventId": "uuid...",
  "timestamp": "iso-8601...",
  "category": "Prompt Ambiguity",
  "details": "..."
}
```

## Refinement Loop

The refinement aggregator periodically scans completed sprints, groups friction events by pattern, and proposes protocol improvements via Pull Requests.
