Feature: A feature the parser rejects

  @skip
  Scenario: an exempt scenario that still cannot compile
    Given a step no definition claims
  this line is not Gherkin at all
    Then the parser reports a position
