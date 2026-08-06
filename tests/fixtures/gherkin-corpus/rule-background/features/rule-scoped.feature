Feature: Roster under rules

  # Gherkin runs this Background for every scenario in the feature, including
  # the Rule-nested ones below. This feature has no scenario of its own, so a
  # walker that only emits a container's Background when that same container
  # holds scenarios never checks these steps.
  Background:
    Given I am signed in
    And no definition anywhere claims this background step

  Rule: a coach sees their own roster

    Scenario: the roster loads
      Then I see the roster
