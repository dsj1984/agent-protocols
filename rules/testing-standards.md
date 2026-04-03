# Testing Standards

Rules to enforce robust, reliable, and consistent testing methodologies.

## File Naming and Placement

- Test files MUST end in `.test.ts` or `.test.tsx` (never `.spec.ts`).
- Colocate tests alongside the file they test if possible, or inside a dedicated
  `__tests__` directory in the same module.

## Test Structure (Arrange, Act, Assert)

- Break every test into three distinct blocks:
  1. **Arrange:** Set up mocks, state, and inputs.
  2. **Act:** Call the function or render the component.
  3. **Assert:** Validate the outputs or side-effects.

## Mocking & Dependencies

- Unit tests MUST mock all external network calls and database transactions.
- Never write tests that depend on specific real-world timing unless explicitly
  testing a timeout (use fake timers instead).
- Do not let mocked state leak between tests. Always reset mocks in an
  `afterEach` block.
