---
name: stripe-integration
description:
  Implements secure Stripe payments and subscription billing. Use when handling
  card data (PCI compliance via Elements/Checkout), verifying webhook
  signatures, attaching `idempotencyKey` to mutations, or treating the
  server-side webhook as the source of truth for entitlement changes.
vendor: stripe
---

# Skill: Stripe Payments & Billing

Standard procedures for secure and robust payment + subscription billing
integration using Stripe.

## 1. Core Principles

- **PCI Compliance:** Never let sensitive card data touch your servers. Use
  Stripe Elements or Checkout.
- **Webhooks are Mandatory:** Never rely on successful client-side redirects to
  confirm payments. Always verify via webhooks. Webhook handlers MUST verify the
  `Stripe-Signature` header using the raw request body and the configured
  webhook secret before parsing any data.
- **Idempotency:** Every Stripe API mutation MUST include an `idempotencyKey` to
  prevent duplicate charges or state changes during network retries.
- **Server is Source of Truth:** Never trust client-side success states for
  granting access or upgrading tiers; always rely on the asynchronous
  server-side webhook to update the database.

## 2. Technical Standards

- **Stripe SDK:** Use the official `stripe` Node.js library for backend
  operations.
- **Elements / Checkout:** Use Stripe Elements for custom-branded checkout or
  Checkout for the fastest implementation.
- **Error Handling:** Gracefully handle payment failures, card declines, and
  expired sessions.

## 3. Best Practices

- **Test Mode:** Use Stripe's test environment and test card numbers for all
  development and QA.
- **Logging:** Log Stripe event IDs for troubleshooting, but exclude any
  sensitive customer data.
- **Sub-records:** Store Stripe IDs (Customer ID, Price ID, Subscription ID) in
  your database, not PCI-sensitive data.
