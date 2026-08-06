Feature: Scope A

  Scenario: one bound step and two unbound ones
    Given I am on the app-a dashboard
    When I open the app-b admin console
    Then no definition anywhere claims this step
