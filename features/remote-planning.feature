Feature: Remote planning phase parity
  As an operator driving Epic planning end-to-end from GitHub
  I want the spec and decompose phases to behave identically whether invoked
  by the local /sprint-plan wrapper or fired by epic-orchestrator.yml
  So that there is one mental model regardless of how the plan starts.

  Background:
    Given a fake ticketing provider seeded with an Epic carrying `type::epic`
    And a plan-router backed by the shared label → phase map
    And a remote-bootstrap adapter that records the slash command it would launch

  Scenario: (a) agent::planning label triggers the spec phase via --phase spec
    Given the Epic carries `agent::planning`
    When the remote bootstrap resolves the phase from its CLI args
    Then it launches `/sprint-plan-spec <epicId>`
    And the resolved phase descriptor is the `spec` descriptor from plan-router

  Scenario: (b) review-spec is a parking state, not a trigger
    Given the Epic carries `agent::review-spec`
    When the remote bootstrap is invoked without the spec or decompose label
    Then epic-orchestrator.yml's label filter excludes the run
    And nextPhaseForEpic advances to the `decompose` descriptor for the local wrapper

  Scenario: (c) agent::decomposing label triggers the decompose phase via --phase decompose
    Given the Epic carries `agent::decomposing`
    When the remote bootstrap resolves the phase from its CLI args
    Then it launches `/sprint-plan-decompose <epicId>`
    And the resolved phase descriptor is the `decompose` descriptor from plan-router

  Scenario: (d) absent --phase the bootstrap defaults to execute for v5.14.0 parity
    Given no `--phase` flag is supplied on the CLI
    And no `PHASE` environment variable is set
    When the remote bootstrap resolves the phase
    Then it launches `/sprint-execute <epicId>`
    And the resolved phase descriptor is the `dispatch` descriptor from plan-router

  Scenario: (e) unknown --phase values are rejected before any side effects
    Given the remote bootstrap is invoked with `--phase bogus`
    When the remote bootstrap resolves the phase
    Then resolution throws before cloning, secret materialization, or npm ci
    And the error message enumerates the valid phase slugs
