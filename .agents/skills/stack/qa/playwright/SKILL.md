---
name: playwright
description:
  Robust E2E browser testing with Playwright. Use when writing browser-driven
  tests — leverage auto-waiting (no `waitForTimeout`), prefer user-visible
  locators (`getByRole`, `getByText`, `getByLabel`) over CSS/XPath, reuse
  `storageState` for auth, and enable trace-on-first-retry for CI debugging.
vendor: playwright
---

# Skill: Playwright

Standard operating procedures for robust, end-to-end (E2E) browser testing.

## 1. Core Principles

- **End-to-End focus:** Test the application as a user would, through the
  browser.
- **Auto-waiting:** Leverage Playwright's built-in auto-waiting instead of
  hardcoded `waitForTimeout` calls.
- **Resilience:** Write tests that survive minor UI changes (e.g., color tweaks)
  by using robust selectors.

## 2. Technical Standards

- **Locators:** Use user-visible locators (e.g., `getByRole`, `getByText`,
  `getByLabel`) over brittle CSS selectors or XPath.
- **State Management:** Use `storageState` to reuse authentication between
  tests, avoiding repetitive login flows.
- **Visual Testing:** Use `toHaveScreenshot()` for critical UI layouts to detect
  visual regressions.

## 3. Best Practices

- **Parallelism:** Ensure tests are independent so they can run concurrently to
  reduce CI time.
- **Tracing:** Enable trace recording on failure to quickly debug CI issues with
  the Playwright Trace Viewer.
- **Test Data:** Use a unique data set per test run or clean up state to prevent
  cross-contamination.
