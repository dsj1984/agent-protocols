@domain-billing
Feature: Issuing invoices
  Billing admins and account owners issue invoices to customers. The system
  rejects issues that violate account-state or role constraints and records
  successful issues on the customer's timeline.

  Background:
    Given the billing workspace is configured with the default tax profile

  @smoke
  Scenario: A billing-admin issues an invoice for a customer in good standing
    Given a signed-in billing-admin
    And a customer with a zero account balance
    When the billing-admin issues an invoice for that customer for 500 USD
    Then the invoice appears in the issued invoices list
    And the customer's timeline shows the invoice was issued

  @risk-high
  Scenario: Issuing is rejected when the customer has a negative balance
    Given a signed-in billing-admin
    And a customer with a negative account balance
    When the billing-admin issues an invoice for that customer
    Then the issue is rejected
    And the rejection message names the outstanding amount

  Scenario Outline: <user-role> access to invoice issuing
    Given a signed-in <user-role>
    And a customer with a zero account balance
    When they attempt to issue an invoice for that customer
    Then the attempt is <issue-outcome>

    Examples:
      | user-role      | issue-outcome |
      | account-owner  | accepted      |
      | billing-admin  | accepted      |
      | viewer         | denied        |

    @risk-high
    Examples:
      | user-role      | issue-outcome |
      | external-audit | denied        |
