# PRD: E2E Testing Phase 1 - Playwright Scaffold & Platform Fixtures

## Introduction

Establish the foundational E2E testing infrastructure for Alex, a hybrid Next.js/Electron app. This phase creates the directory structure, installs Playwright, and implements a platform-aware fixture that allows the same test specs to run on both web and Electron with minimal duplication.

## Goals

- Install Playwright as a dev dependency
- Create the `e2e/` directory structure with subdirectories for fixtures, page objects, specs, and helpers
- Implement a platform-aware `appPage` fixture that abstracts web vs. Electron launch
- Create Playwright configuration files supporting both web and Electron test modes
- Add npm scripts for running tests in different modes (web, Electron, headed, debug)
- Verify the fixture works by writing a smoke test

## User Stories

### US-001: Install Playwright and dependencies
**Description:** As a developer, I need Playwright installed so I can write and run E2E tests.

**Acceptance Criteria:**
- [ ] `@playwright/test` and `playwright` added to `package.json` devDependencies
- [ ] Installation completes successfully via `pnpm install`
- [ ] Playwright CLI is available: `pnpm exec playwright --version` returns version
- [ ] Typecheck passes

### US-002: Create e2e directory structure
**Description:** As a developer, I need an organized directory structure so tests are easy to locate and maintain.

**Acceptance Criteria:**
- [ ] Create `e2e/fixtures/` directory
- [ ] Create `e2e/page-objects/` directory
- [ ] Create `e2e/specs/` directory
- [ ] Create `e2e/helpers/` directory
- [ ] Create `e2e/playwright.config.ts` file
- [ ] Create `e2e/global-setup.ts` file (stub implementation for now)
- [ ] Directory structure matches the plan in `docs/product/testing/PLAN.md:16-41`

### US-003: Implement platform-aware app fixture
**Description:** As a developer, I need a fixture that launches either web or Electron based on environment variables so I can write tests once and run them on both platforms.

**Acceptance Criteria:**
- [ ] Create `e2e/fixtures/app.fixture.ts`
- [ ] Fixture reads `E2E_PLATFORM` environment variable
- [ ] When `E2E_PLATFORM=electron`, fixture uses `_electron.launch()` with `electron/dist/main.js`
- [ ] When `E2E_PLATFORM=web` (or unset), fixture uses standard Playwright `page` and navigates to `BASE_URL` or `http://localhost:3000`
- [ ] Fixture returns a `Page` object regardless of platform
- [ ] Fixture properly cleans up (closes app/page) after use
- [ ] Electron mode sets `NODE_ENV=test` in environment
- [ ] Code matches pattern from `docs/product/testing/PLAN.md:49-73`
- [ ] Typecheck passes

### US-004: Create Playwright configuration
**Description:** As a developer, I need Playwright configuration that supports both web and Electron modes so tests run correctly in each environment.

**Acceptance Criteria:**
- [ ] Create `e2e/playwright.config.ts`
- [ ] Configuration reads `E2E_PLATFORM` to determine mode
- [ ] In Electron mode: single `electron` project, no web server
- [ ] In web mode: `chromium` project, starts Next.js dev server on port 3000
- [ ] `testDir` points to `./specs`
- [ ] Timeout set to 60 seconds
- [ ] Retries set to 2 in CI, 0 locally
- [ ] Workers set to 1 (serial execution for SQLite safety)
- [ ] Trace, screenshot, and video configured: `on-first-retry` or `only-on-failure`
- [ ] `globalSetup` points to `./global-setup.ts`
- [ ] Code matches pattern from `docs/product/testing/PLAN.md:96-128`
- [ ] Typecheck passes

### US-005: Create global setup stub
**Description:** As a developer, I need a global setup file that prepares the test environment before tests run.

**Acceptance Criteria:**
- [ ] Create `e2e/global-setup.ts`
- [ ] Function is exported as default
- [ ] For now, stub implementation logs "Global setup complete" and returns
- [ ] Future phases will add database reset/seed here
- [ ] Typecheck passes

### US-006: Add package.json scripts
**Description:** As a developer, I need npm scripts to easily run tests in different modes.

**Acceptance Criteria:**
- [ ] Add `"e2e": "playwright test --config=e2e/playwright.config.ts"` to scripts
- [ ] Add `"e2e:web": "E2E_PLATFORM=web playwright test --config=e2e/playwright.config.ts"` to scripts
- [ ] Add `"e2e:electron": "E2E_PLATFORM=electron playwright test --config=e2e/playwright.config.ts"` to scripts
- [ ] Add `"e2e:headed": "E2E_PLATFORM=web playwright test --config=e2e/playwright.config.ts --headed"` to scripts
- [ ] Add `"e2e:debug": "E2E_PLATFORM=web playwright test --config=e2e/playwright.config.ts --debug"` to scripts
- [ ] Scripts match pattern from `docs/product/testing/PLAN.md:310-318`

### US-007: Write smoke test to verify fixture
**Description:** As a developer, I need a simple smoke test that verifies the platform fixture works on both web and Electron.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/smoke.spec.ts`
- [ ] Import `test` from `e2e/fixtures/app.fixture.ts`
- [ ] Test navigates to app and verifies the page title contains "Alex"
- [ ] Test uses `appPage` fixture from the custom fixture
- [ ] Test passes when run with `pnpm e2e:web`
- [ ] Test passes when run with `pnpm e2e:electron` (requires `electron/dist/main.js` to exist)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Playwright must be installed as a dev dependency using pnpm
- FR-2: Directory structure must match `e2e/{fixtures,page-objects,specs,helpers}` pattern
- FR-3: Platform fixture must export a custom `test` object with `appPage` fixture
- FR-4: `appPage` fixture must return a Playwright `Page` object regardless of platform
- FR-5: Playwright config must support both `E2E_PLATFORM=web` and `E2E_PLATFORM=electron`
- FR-6: Electron mode must launch the app from `electron/dist/main.js`
- FR-7: Web mode must start Next.js dev server automatically
- FR-8: All npm scripts must use the custom config path `e2e/playwright.config.ts`
- FR-9: Smoke test must verify basic navigation works on both platforms

## Non-Goals

- No actual test specs for auth, library, readers, etc. (covered in later phases)
- No database seeding or test data fixtures (Phase 3+)
- No page object models (Phase 2+)
- No CI/CD integration (Phase 7)
- No test coverage reporting
- No visual regression testing
- No performance testing

## Technical Considerations

- Electron tests require `electron/dist/main.js` to exist — must run `npx tsc -p electron/tsconfig.json` before running Electron tests
- SQLite is single-writer, so Playwright workers must be set to 1 to avoid lock contention
- The app uses NextAuth with session cookies; auth fixtures will be added in Phase 2
- Web mode needs Next.js running; Playwright `webServer` config handles this automatically
- Electron mode spawns its own Next.js server internally; no `webServer` needed
- Test isolation will be handled via database resets in `global-setup.ts` (future phases)

## Success Metrics

- Smoke test passes on both web (`pnpm e2e:web`) and Electron (`pnpm e2e:electron`)
- Fixture code is under 50 lines and easy to understand
- No errors or warnings during Playwright installation
- Typecheck passes for all new files

## Open Questions

- Should we add Firefox/WebKit browsers for web testing, or stick with Chromium only?
  - Recommendation: Start with Chromium only; add others if needed later
- Should we use a different port for tests to avoid conflicts with dev server?
  - Recommendation: Use 3000 for now; reuseExistingServer handles conflicts
