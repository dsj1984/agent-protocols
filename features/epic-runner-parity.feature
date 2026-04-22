Feature: Epic-runner dual-mode parity
  As an operator driving an Epic end-to-end
  I want identical behavior whether the runner is invoked locally or by
  the GitHub Actions remote trigger
  So that there is one mental model regardless of how the run starts.

  Background:
    Given a fake ticketing provider seeded with an Epic and its child Stories
    And an injected spawn adapter that reports `done` by default

  Scenario: (a) Local /sprint-execute <epicId> end-to-end on a fake-provider fixture
    When I invoke runEpic with the Epic id
    Then every Story is dispatched in wave order
    And the Epic ends with `agent::review`
    And a single `epic-run-state` checkpoint comment is present on the Epic
    And each wave emits both a `wave-N-start` and `wave-N-end` comment

  Scenario: (b) GitHub-triggered remote run (simulated via provider stub)
    Given the Epic starts carrying `agent::dispatching`
    When the remote-bootstrap invokes runEpic with the same Epic id
    Then the orchestrator flips the Epic to `agent::executing` before the first wave
    And the final label is `agent::review`
    And the wave history matches the local invocation for the same fixture

  Scenario: (c) Local /sprint-execute <storyId> against a story under a remote-managed Epic
    Given an Epic already at `agent::executing`
    And a Story whose parent is that Epic
    When I run the per-Story initializer for the Story
    Then the Story branch is created without disturbing the Epic label
    And the Story's child Tasks transition to `agent::executing`

  Scenario: (d) Blocker halt-and-resume cycle
    Given a Story in wave 1 reports `failed`
    When the orchestrator delegates to BlockerHandler
    Then the Epic is marked `agent::blocked`
    And a structured friction comment cites the failing Story
    When the operator flips the Epic back to `agent::executing`
    Then the orchestrator resumes and the remaining waves complete
    And the wave history records the halted wave alongside completed waves
