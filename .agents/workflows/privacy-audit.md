---
description: Run a privacy and PII data audit
---

# Privacy and PII Data Audit

## Role

Data Privacy Officer & Security Engineer

## Context & Objective

You are conducting a privacy audit to identify potential mishandling of
Personally Identifiable Information (PII) and ensure compliance with data
protection standards (GDPR, CCPA). Your goal is to find accidental logging,
insecure storage, or unnecessary collection of sensitive data.

## Step 1: Scanning for PII Patterns

Scan the codebase for patterns related to sensitive data. Pay attention to:

- **Log Statements:** Search for `console.log`, `logger.info`, etc., that might
  be outputting `user`, `email`, `password`, `token`, `address`, or `phone`.
- **Storage:** Check `localStorage`, `sessionStorage`, and database schemas for
  unencrypted sensitive fields.
- **API Requests:** Review outgoing requests to ensure PII is not leaked in URLs
  (query params) or unencrypted headers.
- **Analytics:** Ensure third-party analytics calls are anonymized.

## Step 2: Analysis Dimensions

Evaluate the codebase against these privacy pillars:

1. **Data Minimization:** Is the application collecting more PII than strictly
   necessary for its functions?
2. **Leaky Logging:** Are sensitive objects being logged to stdout/stderr or
   external logging services?
3. **Insecure Transmission:** Is PII sent over non-TLS connections or via GET
   parameters?
4. **Hardcoded Secrets:** Are there any API keys, salts, or credentials stored
   in plain text?
5. **Consent & Retention:** Check for logic related to data deletion (Right to
   be Forgotten) and consent management.

## Step 3: Output Requirements

Generate and save a report to `privacy-audit.md` in the project root.

```markdown
# Privacy & PII Audit Report

## Executive Summary

[Overview of the privacy posture and critical risks identified.]

## Critical Findings (Immediate Action Required)

- [List findings that represent immediate data leaks or compliance violations.]

## General Findings & Improvements

### [Issue Title]

- **Type:** [Leaky Log | Insecure Storage | Data Over-collection]
- **Location:** [File/Line/Module]
- **Description:** [What is the risk?]
- **Recommendation:** [How to remediate, e.g., "Use a mask function for logs",
  "Move to HttpOnly cookies".]

## Privacy Scorecard

- **Data Encryption:** [Pass/Fail/Partial]
- **Logging Safety:** [Pass/Fail/Partial]
- **Minimization:** [Pass/Fail/Partial]
```

## Constraint

This is a **read-only** audit. Do not modify any code. Focus on identifying
risks and providing clear remediation steps.
