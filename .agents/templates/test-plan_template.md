# Domain [X]: [Domain Name]

> **Test Case Template Standard** Copy and paste the block below for every new
> test case in this domain. Do not deviate from the markdown syntax, backticks,
> or checkbox placement.

---

### [DOMAIN-001] [Feature Name]

- **Seed Account:** [Role] (`[exact.email@from-matrix.com]`)
- **Target Platform:** [Web | Mobile iOS | Mobile Android | Cross-Platform]
- **Entry URL:** `/exact-starting-route`
- **Execution Status:** - [ ] Pending

**System States:**

- [ ] [Prerequisite 1: e.g., User must not have an active subscription]
- [ ] [Prerequisite 2: e.g., Database table `X` must be empty for this user]

**Execution Steps:**

- [ ] 1. Navigate to the starting route via
     `` `[data-testid="nav-link-name"]` ``.
- [ ] 2. [Human readable action] utilizing
     `` `[data-testid="semantic-target-name"]` ``.
- [ ] 3. Submit the form/action explicitly clicking
     `` `[data-testid="btn-submit-action"]` ``.

**Verification:**

_Visual Assertions:_

- [ ] [Human readable UI outcome] mapping to the active DOM at
      `` `[data-testid="view-success-state"]` ``.
- [ ] [Secondary UI check] ensuring visibility of
      `` `[data-testid="element-specific-feedback"]` ``.

_System Assertions:_

- [ ] Database: Query
      `` `SELECT [columns] FROM [table_name] WHERE [condition] = ?` ``. Expect
      `[column] = '[explicit_value]'`.
- [ ] API: Verify pipeline `` `GET /api/v1/[endpoint]` `` returns `200 OK` with
      `[explicit_payload_shape]`.

---
