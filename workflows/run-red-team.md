---
description:
  Manually execute adversarial security tests on target code to identify
  vulnerabilities.
---

# Run Red-Team (Adversarial Tribunal)

## Role

Adopt the `security-engineer` persona from `.agents/personas/`.

## Context & Objective

Your objective is to identify and exploit vulnerabilities within a specific
target scope. Unlike functional QA, your goal is **adversarial**: you perform
property-based testing, fuzzing, and mutation analysis to bypass validation
rules, corrupt state, or leak sensitive data.

This is an **on-demand tribunal** used for pre-release hardening or
high-assurance audits.

## Step 1 - Target Identification

1.  The user should specify a `[TARGET_SCOPE]` (branch, directory, or specific
    files).
2.  Analyze the target's:
    - **API Boundaries**: Hono routes, Zod schemas, and validation logic.
    - **Data Persistence**: Drizzle schemas and database mutation patterns.
    - **Security Layers**: Auth middleware, IAM permissions, and RBAC logic.

## Step 2 - Dynamic Exploit Generation

Generate local, temporary test scripts (e.g., using `vitest` or `fuzzing`
payloads) explicitly designed to break the code. Focus on:

- **Edge cases**: Extreme numerical values, empty strings, and long-tail inputs.
- **Injection**: Attempt common SQL or script injection patterns within
  validation schemas.
- **Race conditions**: Identify operations that could lead to inconsistent
  state.
- **Auth bypass**: Seek logic flaws in authorization checks.

## Step 3 - Tribunal Execution

Execute your scripts in the terminal: `npm test [TARGET_SCOPE]` (or your custom
fuzz script).

## Step 4 - Resolution & Reporting

1.  **If no vulnerabilities are found**: Report the successful cross-examination
    to the user.
2.  **If a vulnerability is identified**:
    - Group the findings by severity (**Critical**, **High**, **Medium**).
    - Report the exact exploit vector and recommended patch.
    - If instructed by the user, immediately transition to a fix phase.
3.  **Mandatory Cleanup**: Delete all temporary fuzz/mutation scripts. Do NOT
    pollute the functional test suite with adversarial code.

## Constraint

Maintain an adversarial mindset. Do NOT test for "happy paths". Focus entirely
on "How can I break this?" or "How can I bypass the current security layer?".
