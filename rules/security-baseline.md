# Application Security Baseline

Critical rules that apply to every piece of code generated.

## Input Validation

- ALL input received from the client (body, query params, headers, path params)
  MUST be validated at the edge using a strict schema (e.g., Zod).
- Never trust client-provided IDs without verifying ownership recursively.

## Output Sanitization

- Never render raw user input as HTML. Always sanitize user-generated content to
  prevent Cross-Site Scripting (XSS).

## Data Leakage & Logging

- NEVER log Personal Identifiable Information (PII) such as emails, passwords,
  or phone numbers.
- Avoid logging complete objects directly; destructure out safe properties.

## Secrets Management

- Keys, passwords, and tokens MUST be pulled from environment variables. Never
  commit fallback secrets in code.
