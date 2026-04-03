---
description:
  Execute test cases defined in a markdown test plan and output results to a
  copy
---

# Run Test Plan Workflow

## Role

Lead QA Automation Execution Engine

## Context & Objective

Your objective is to methodically execute the test cases defined in the provided
markdown test plan. You must make a copy of the test plan file, append
`-RESULTS` to its filename, and update that new copy inline with the results.

**Target File:** `[TARGET_FILE_PATH]` — The user must provide the target file
path when executing this command.

## Step 1: Context Gathering

1. Read the provided Target File. Identify all test cases where the
   `Execution Status:` is currently `- [ ] Pending`.
2. Read `00-test-data-matrix.md` to map the "Seed Account" listed in the test
   cases to their exact login credentials.

## Step 2: Execution Strategy

For each pending test case, you must verify the Visual (UI) and System
(Database/API) assertions. To do this:

1. Write a temporary Playwright test script (e.g., `temp-test-runner.spec.ts`)
   that executes the "Execution Steps" using the exact `data-testid` locators
   provided in the backticks.
2. Include the "System Assertions" (SQL pseudocode) in your script by connecting
   to the local database environment to verify the backend state. // turbo
3. Run the script silently in the terminal using your environment's test runner
   (e.g., `npx playwright test temp-test-runner.spec.ts`).

## Step 3: Stateful Markdown Updating

Based on the execution results, you must first make a copy of the Target File,
appending `-RESULTS` to the filename (e.g., if target is `01-test.md`, copy to
`01-test-RESULTS.md`). You must then modify this _new_ `-RESULTS` file directly
using your file editing tools. DO NOT output the updated file in the chat; write
directly to the file system. DO NOT modify the original Target File.

- **If a step or assertion PASSES:** Change the markdown checkbox from `- [ ]`
  to `- [x]`.
- **If a step or assertion FAILS:** Leave the checkbox as `- [ ]`, but append a
  bolded error reason immediately after the line (e.g.,
  `- [ ] Locate the Submit Button... **[FAILED: Locator timeout after 5000ms]**`).
- **Update the overall status:** Change `- [ ] Pending` to either `- [x] PASSED`
  or `- [ ] FAILED` based on the outcome of the assertions.

## Step 4: Cleanup & Rules

1. Delete any temporary test scripts you created during this process.
2. Isolate failures. If Test Case 1 fails, you must catch the error, log it in
   the markdown, and continue executing Test Case 2. Do not abort the entire
   run.
3. Treat the markdown file as the absolute source of truth. Do not invent new
   test steps; execute exactly what is written.

## Step 5: Version Control & Cleanliness

You may create temporary files and the `*-RESULTS.md` file during execution.
However, **DO NOT commit, check in, or stage any changes to the repository.**

- **No Repository Mutations:** The test results and temporary scripts should
  exist only in the local file system for the user to review.
- **Original File Integrity:** Do not modify the original test plan file.
- **Cleanup:** You should still delete any temporary Playwright scripts
  (`temp-test-runner.spec.ts`) after the run is complete.

## Constraint

Adhere strictly to the templates and instructions provided.
