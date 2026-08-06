Feature: A corpus the config cannot see

  # These live in `features/`, but the scope points at `featurez/`. Nothing
  # here is checked — the blackout this fixture exists to catch.
  Scenario: an unbound step nobody checks
    Given no definition anywhere claims this step
