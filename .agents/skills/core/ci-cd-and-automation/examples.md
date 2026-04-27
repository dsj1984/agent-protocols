# CI/CD and Automation — Examples

Long stack-specific snippets extracted from `SKILL.md` so the skill stays
focused on policy and routing. The samples below assume GitHub Actions plus
Node 22 / npm; adapt to your project's runner, package manager, and language.

---

## GitHub Actions: Basic CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Test
        run: npm test -- --coverage

      - name: Build
        run: npm run build

      - name: Security audit
        run: npm audit --audit-level=high
```

## GitHub Actions: With Database Integration Tests

```yaml
integration:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_DB: testdb
        POSTGRES_USER: ci_user
        POSTGRES_PASSWORD: ${{ secrets.CI_DB_PASSWORD }}
      ports:
        - 5432:5432
      options: >-
        --health-cmd pg_isready --health-interval 10s --health-timeout 5s
        --health-retries 5

  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci
    - name: Run migrations
      run: npx prisma migrate deploy
      env:
        DATABASE_URL:
          postgresql://ci_user:${{ secrets.CI_DB_PASSWORD
          }}@localhost:5432/testdb
    - name: Integration tests
      run: npm run test:integration
      env:
        DATABASE_URL:
          postgresql://ci_user:${{ secrets.CI_DB_PASSWORD
          }}@localhost:5432/testdb
```

> **Note:** Even for CI-only test databases, use GitHub Secrets for credentials
> rather than hardcoding values. This builds good habits and prevents accidental
> reuse of test credentials in other contexts.

## GitHub Actions: E2E Tests

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci
    - name: Install Playwright
      run: npx playwright install --with-deps chromium
    - name: Build
      run: npm run build
    - name: Run E2E tests
      run: npx playwright test
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
```

## Deployment: Preview on PR

```yaml
# Deploy preview on PR (Vercel/Netlify/etc.)
deploy-preview:
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
    - name: Deploy preview
      run: npx vercel --token=${{ secrets.VERCEL_TOKEN }}
```

## Deployment: Manual Rollback Workflow

```yaml
# Manual rollback workflow
name: Rollback
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to rollback to'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
      - name: Rollback deployment
        run: |
          # Deploy the specified previous version
          npx vercel rollback ${{ inputs.version }}
```

## Caching and Parallelism

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm test -- --coverage
```

## Dependency Updates: Dependabot

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

## Feature Flag Pattern

```typescript
// Simple feature flag pattern
if (featureFlags.isEnabled('new-checkout-flow', { userId })) {
  return renderNewCheckout();
}
return renderLegacyCheckout();
```

**Flag lifecycle:** Create → Enable for testing → Canary → Full rollout →
Remove the flag and dead code. Flags that live forever become technical debt —
set a cleanup date when you create them.
