# Cross-Platform E2E Testing Strategy
 
## Overview
 
Alex is a hybrid app: a Next.js 16 web application wrapped in Electron 34 for desktop. The same UI runs on all platforms — Electron loads `http://127.0.0.1:3210` in a BrowserWindow. This architectural detail is key: **one set of test specs can cover both web and desktop** with a thin abstraction layer for launch/teardown.
 
**Recommended framework: [Playwright](https://playwright.dev/)**
 
Playwright has first-class support for both browser-based web testing and Electron app testing (`electron.launch()`). It runs on all three OS targets. No other framework covers both web and Electron with the same API surface.
 
---
 
## Architecture
 
```
e2e/
├── fixtures/
│   ├── app.fixture.ts        # Platform-aware app launcher (web vs Electron)
│   ├── auth.fixture.ts       # Shared login/session helpers
│   └── library.fixture.ts    # Seed books, collections, DB state
├── page-objects/
│   ├── login.page.ts         # Login page selectors + actions
│   ├── library.page.ts       # Library grid selectors + actions
│   ├── reader.page.ts        # PDF/EPUB reader selectors + actions
│   ├── collections.page.ts   # Collections page
│   └── admin.page.ts         # Admin panel
├── specs/
│   ├── auth.spec.ts          # Login, logout, session persistence
│   ├── library.spec.ts       # Browse, search, filter, sort books
│   ├── pdf-reader.spec.ts    # Open PDF, navigate pages, track progress
│   ├── epub-reader.spec.ts   # Open EPUB, scroll, track progress
│   ├── collections.spec.ts   # Create, edit, share collections
│   ├── progress.spec.ts      # Reading progress save/restore
│   ├── admin.spec.ts         # User management, settings
│   └── desktop.spec.ts       # Electron-only: tray, library path, IPC
├── helpers/
│   ├── db.ts                 # Direct SQLite setup/teardown for test isolation
│   └── fixtures.ts           # Test EPUB/PDF file management
├── playwright.config.ts      # Main Playwright configuration
└── global-setup.ts           # Build app, seed DB, start server
```
 
### Key design decisions
 
1. **Page Object Model** — Selectors and interactions live in `page-objects/`, specs only contain assertions and flow logic. When the UI changes, you fix one file, not every test.
 
2. **Platform-aware fixture** — A single custom Playwright fixture abstracts away how the app is launched:
 
```ts
// e2e/fixtures/app.fixture.ts
import { test as base, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
 
type AppFixture = { appPage: Page };
 
export const test = base.extend<AppFixture>({
  appPage: async ({ page }, use) => {
    if (process.env.E2E_PLATFORM === 'electron') {
      const app = await electron.launch({
        args: ['electron/dist/main.js'],
        env: { ...process.env, NODE_ENV: 'test' },
      });
      const window = await app.firstWindow();
      await use(window);
      await app.close();
    } else {
      // Web: standard Playwright browser page
      await page.goto(process.env.BASE_URL ?? 'http://localhost:3000');
      await use(page);
    }
  },
});
```
 
3. **Specs are platform-agnostic by default** — Every spec in `specs/` uses `appPage` from the fixture. The fixture handles web vs Electron. Specs that test Electron-only features (tray icon, IPC, native file dialogs) live in `desktop.spec.ts` and are skipped on web via `test.skip()` guards.
 
4. **Test isolation via DB reset** — Each test run starts with a fresh SQLite database. The `global-setup.ts` script runs `db:reset` + `db:seed`, and individual tests that mutate state use transactions that roll back.
 
---
 
## Platform Matrix
 
| Platform | Runner          | Launch mode         | Browser engine     |
|----------|-----------------|---------------------|--------------------|
| Web      | Any CI runner   | `playwright test`   | Chromium (default) |
| macOS    | `macos-latest`  | Electron + Chromium | Electron's Chromium|
| Linux    | `ubuntu-latest` | Electron + Chromium | Electron's Chromium|
 
All four entries run the **same spec files** (minus `desktop.spec.ts` which is skipped on web).
 
---
 
## Playwright Configuration
 
```ts
// e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
 
const isElectron = process.env.E2E_PLATFORM === 'electron';
 
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Serial for SQLite (single-writer)
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: isElectron
    ? [{ name: 'electron', testDir: './specs' }]
    : [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        // Optional: run web tests against multiple browsers
        // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        // { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
      ],
  webServer: isElectron
    ? undefined // Electron spawns its own Next.js server
    : {
        command: 'pnpm build && pnpm start',
        port: 3000,
        reuseExistingServer: !process.env.CI,
      },
  globalSetup: './global-setup.ts',
});
```
 
---
 
## Test Specs (Functional Parity)
 
Every spec below runs identically on web and all three desktop platforms.
 
### `auth.spec.ts`
- Login with valid credentials → redirects to library
- Login with invalid credentials → shows error
- Logout → redirects to login
- Session persistence → refresh page, still logged in
- First-run setup → create admin account (onboarding flow)
 
### `library.spec.ts`
- Library displays ingested books with covers
- Search filters books by title/author
- Sort by title, author, date added
- Filter by file type (PDF, EPUB)
- Empty state renders correctly
- Book card click navigates to reader
 
### `pdf-reader.spec.ts`
- Open a PDF → renders first page
- Navigate to next/previous page
- Jump to specific page number
- Progress bar reflects current position
- Progress persists after navigating away and returning
 
### `epub-reader.spec.ts`
- Open an EPUB → renders content
- Scroll advances through content
- Progress (CFI + percentage) saves on navigation
- Re-open book → resumes at saved location
- Theme changes (dark/light) apply inside EPUB iframe
 
### `collections.spec.ts`
- Create a new collection
- Add books to a collection
- Remove books from a collection
- Delete a collection
- Share a collection (public link) → accessible without auth
 
### `progress.spec.ts`
- Reading progress saves to API (`PUT /api/books/[id]/progress`)
- Progress survives page reload (localStorage + API roundtrip)
- Multiple users track independent progress on the same book
 
### `admin.spec.ts`
- Admin can create/edit/delete users
- Non-admin cannot access admin routes
- Library path setting is visible (Electron) or hidden (web)
 
### `desktop.spec.ts` *(Electron-only, skipped on web)*
- System tray icon appears
- Tray menu options function (show/hide window, quit)
- Library path selection dialog opens via IPC
- Rescan library triggers file watcher
- Window close minimizes to tray (if configured)
 
---
 
## CI/CD Integration
 
Add a new workflow file `.github/workflows/e2e.yml`:
 
```yaml
name: E2E Tests
 
on:
  pull_request:
    branches: ['*']
  push:
    branches: [main]
 
jobs:
  e2e-web:
    name: e2e-web
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
      - run: pnpm build:native
      - run: pnpm db:push && pnpm db:seed
      - run: pnpm exec playwright test --config=e2e/playwright.config.ts
        env:
          E2E_PLATFORM: web
          DATABASE_PATH: ./data/test.db
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-web-report
          path: playwright-report/
 
  e2e-electron-linux:
    name: e2e-electron-linux
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
      - run: pnpm build:native && pnpm build
      - run: npx tsc -p electron/tsconfig.json
      - run: pnpm db:push && pnpm db:seed
      - run: xvfb-run --auto-servernum pnpm exec playwright test --config=e2e/playwright.config.ts
        env:
          E2E_PLATFORM: electron
          DATABASE_PATH: ./data/test.db
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-linux-report
          path: playwright-report/
 
  e2e-electron-macos:
    name: e2e-electron-macos
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:native && pnpm build
      - run: npx tsc -p electron/tsconfig.json
      - run: pnpm db:push && pnpm db:seed
      - run: pnpm exec playwright test --config=e2e/playwright.config.ts
        env:
          E2E_PLATFORM: electron
          DATABASE_PATH: ./data/test.db
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-macos-report
          path: playwright-report/
 
```
 
### Notes on CI
 
- **Linux Electron needs `xvfb-run`** — there's no display server in CI. The `xvfb-run` wrapper provides a virtual framebuffer.
- **macOS** has a native display server in GitHub Actions runners; no wrapper needed.
- **`workers: 1`** in Playwright config — SQLite is single-writer. Parallel test workers would cause lock contention. This is acceptable because E2E suites are I/O-bound (waiting for UI), not CPU-bound.
- **Artifacts on failure** — traces, screenshots, and videos upload automatically when tests fail, making debugging CI failures practical.
 
---
 
## Package.json Scripts
 
Add these scripts to `package.json`:
 
```json
{
  "e2e": "playwright test --config=e2e/playwright.config.ts",
  "e2e:web": "E2E_PLATFORM=web playwright test --config=e2e/playwright.config.ts",
  "e2e:electron": "E2E_PLATFORM=electron playwright test --config=e2e/playwright.config.ts",
  "e2e:headed": "E2E_PLATFORM=web playwright test --config=e2e/playwright.config.ts --headed",
  "e2e:debug": "E2E_PLATFORM=web playwright test --config=e2e/playwright.config.ts --debug"
}
```
 
---
 
## Dev Dependencies to Add
 
```
@playwright/test   (E2E framework)
playwright          (browser + Electron automation)
```
 
Install: `pnpm add -D @playwright/test playwright`
 
---
 
## Test Data Strategy
 
1. **Fixture files** — Include small test PDFs and EPUBs in `e2e/helpers/fixtures/` (< 1 MB each). These get copied into the test library path before each run.
2. **Database seeding** — `global-setup.ts` calls `db:reset` and `db:seed`, then runs the watcher once to ingest the fixture files. This guarantees the library has known books.
3. **Per-test isolation** — Tests that create/modify data (collections, users) clean up after themselves or use unique identifiers to avoid interference.
 
---
 
## Implementation Order
 
1. Install Playwright, scaffold `e2e/` directory, write the platform-aware fixture
2. Write `auth.spec.ts` (validates the fixture works on web and Electron)
3. Write `library.spec.ts` (validates book display after seeding)
4. Write `pdf-reader.spec.ts` and `epub-reader.spec.ts` (core reading functionality)
5. Write `collections.spec.ts` and `progress.spec.ts`
6. Write `admin.spec.ts` and `desktop.spec.ts`
7. Add the `e2e.yml` GitHub Actions workflow
8. Wire into PR required checks
 
Each step is independently shippable and testable locally before adding CI.

---

## PR Required Checks (Phase 8)

Main branch protection is configured so that PRs cannot merge until all E2E jobs pass.

### Required checks

The required status checks are:

- `e2e-web`
- `e2e-electron-linux`
- `e2e-electron-macos`

Windows E2E checks are currently disabled and are not required for merge.

These names are case-sensitive and must exactly match the job names in `.github/workflows/e2e.yml`.

### Branch protection behavior

- Pull requests are required before merging to `main`
- Required status checks must pass before merging
- Branches must be up to date before merging (`strict: true`)
- Linear history is required on `main`
- One approval is required before merging

When any required check fails (or is missing), GitHub blocks merge in both UI and API until the check passes.

### Manage required checks with `gh`

Apply or update the protection rule:

```bash
gh api -X PUT repos/jamesacklin/alex/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "e2e-web",
      "e2e-electron-linux",
      "e2e-electron-macos"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
```

Inspect the active protection rule:

```bash
gh api repos/jamesacklin/alex/branches/main/protection
```

### Bypass and override

With `enforce_admins: false`, admins can bypass failed checks if needed for emergencies. This should be used sparingly and logged in the PR for auditability.

### Auto-merge

Repository auto-merge can be enabled with:

```bash
gh api -X PATCH repos/jamesacklin/alex -f allow_auto_merge=true
```

After this is enabled, developers can use PR auto-merge when required checks and approvals are satisfied.
