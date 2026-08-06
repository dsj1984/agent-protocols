Feature: Exemption tags and waivers

  Scenario: a bound scenario
    Given the escapes corpus is loaded

  @skip
  Scenario: an intentionally non-binding scenario
    Given a step that exists nowhere

  Scenario: a waived step
    Given a step the index provably cannot see
