# Skill: Stripe Payments

Standard procedures for secure and robust payment integration using Stripe.

## 1. Core Principles

- **PCI Compliance:** Never let sensitive card data touch your servers. Use
  Stripe Elements or Checkout.
- **Webhooks are Mandatory:** Never rely on successful client-side redirects to
  confirm payments. Always verify via webhooks.
- **Idempotency:** Use idempotency keys for all mutation requests to prevent
  duplicate charges or operations.

## 2. Technical Standards

- **Stripe SDK:** Use the official `stripe` Node.js library for backend
  operations.
- **Elements/Checkout:** Use Stripe Elements for custom-branded checkout or
  Checkout for the fastest implementation.
- **Error Handling:** Gracefully handle payment failures, card declines, and
  expired sessions.

## 3. Best Practices

- **Test Mode:** Use Stripe's test environment and test card numbers for all
  development and QA.
- **Logging:** Log Stripe event IDs for troubleshooting, but exclude any
  sensitive customer data.
- **Sub-records:** Store Stripe IDs (Customer ID, Price ID) in your database,
  not PCI-sensitive data.
