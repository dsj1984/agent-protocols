# Secure Telemetry & PII Logger

**Description:** Prevents compliance breaches by masking Personally Identifiable
Information (PII) in logs.

**Instruction:** You are adding observability and logging to the platform.

- NEVER log raw request bodies, headers, or user objects that might contain PII
  (Emails, DOB, IP Addresses, Stripe Tokens, Passwords).
- If you must log an entity, log its UUID only (e.g.,
  `console.log({ event: 'user_created', userId: user.id })`).
- For errors, log the `error.message` and a safe contextual stack trace, but
  sanitize any user input that caused the error before logging.
