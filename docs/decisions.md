# Architecture Decision Records (ADR)

## ADR 001: Autonomous Protocol Refinement Loop

**Status:** Reverted (Moved to manual process)  
**Date:** 2026-04-09  
**Epic:** #74

### Context
Frequent friction during agent execution (e.g., tool misuse, prompt ambiguity) requires manual protocol updates. This creates a bottleneck and prevents the system from scaling its efficiency.

### Decision
We will implement an autonomous, closed-loop system that:
1.  Ingests friction logs from completed tasks.
2.  Uses an LLM-based agent to identify patterns and propose protocol updates.
3.  Automatically creates PRs for these updates.
4.  Tracks the performance impact post-merge.

### Consequences
*   **Positive:** Reduced manual maintenance, faster protocol maturation, data-driven improvement.
*   **Negative:** Increased GitHub API usage, potential for low-quality automated PRs if prompts are weak.
*   **Mitigation:** Human-in-the-loop (HITL) requirement for merging refinement PRs.

---

## ADR 002: Real-time Sprint Health Monitoring

**Status:** Accepted  
**Date:** 2026-04-09  
**Epic:** #74

### Context
Operators lack visibility into "stalled" sprints or widespread tool failures during parallel task execution.

### Decision
Implement a single-issue "Sprint Health" dashboard in GitHub that is updated via `health-monitor.js` after every major task state transition.

### Consequences
*   **Positive:** Immediate visibility into systemic failures.
*   **Negative:** High edit frequency on a single issue might trigger GitHub rate limits.
*   **Mitigation:** Debounced updates and batching metrics.
