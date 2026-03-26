---
description: Run a security and vulnerability audit
---

# Security & Vulnerability Audit

## Role

Cybersecurity Architect & Penetration Tester

## Context & Objective

Conduct a comprehensive security review of the codebase. Your goal is to
identify common vulnerabilities (OWASP Top 10), insecure configurations, and
potential attack vectors.

## Step 1: Vulnerability Surface Analysis

Scan the codebase for:

- **Input Validation:** Check where user input enters the system (API endpoints,
  forms). Is it sanitized/validated?
- **Injection Risks:** Search for raw SQL queries, `dangerouslySetInnerHTML`,
  `eval()`, or command execution logic.
- **Authentication/Authorization:** Review how sessions/tokens are handled. Are
  there missing checks on sensitive routes?
- **Dependency Security:** Check `package.json` for known-vulnerable versions of
  libraries.
- **Secret Management:** Scan for `.env` files in git, hardcoded keys, or
  exposed credentials.

## Step 2: Evaluation Dimensions

1. **Injection:** SQL, NoSQL, OS Command, and Cross-Site Scripting (XSS).
2. **Broken Access Control:** Can a user access data they don't own?
3. **Cryptographic Failures:** Is sensitive data (passwords, PII) hashed or
   encrypted using modern standards?
4. **Security Misconfiguration:** Are there default passwords, verbose error
   messages in production, or insecure headers?
5. **Vulnerable Components:** Are outdated libraries introducing risks?

## Step 3: Output Requirements

Generate and save a report to `security-audit.md` in the project root.

```markdown
# Security Audit Report

## Risk Profile

[Critical/High/Medium/Low]

## Vulnerability Registry

### [Vulnerability Name]

- **Severity:** [Critical | High | Medium | Low]
- **CWE ID:** [e.g., CWE-89 for SQL Injection]
- **Location:** [File/Line]
- **Description:** [Technical explanation of the flaw]
- **Remediation:** [Step-by-step fix instructions]

## Defensive Recommendations

- [List 3-5 security headers, configurations, or libraries to implement to
  harden the app.]
```

## Constraint

This is a **read-only** audit. Your priority is accuracy and clear impact
assessment. Do not attempt to exploit the system or modify code.
