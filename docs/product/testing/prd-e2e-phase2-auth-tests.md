# PRD: E2E Testing Phase 2 - Authentication Tests

## Introduction

Implement end-to-end tests for Alex's authentication flows, including login, logout, session persistence, and first-run setup. These tests validate that both web and Electron modes handle authentication correctly, including NextAuth credential-based login and Electron's synthetic desktop session.

## Goals

- Create page object models for login and onboarding pages
- Create reusable auth fixture for logging in during tests
- Write comprehensive auth test specs covering all authentication scenarios
- Verify tests pass on both web and Electron platforms
- Ensure test isolation with proper session cleanup

## User Stories

### US-001: Create login page object
**Description:** As a developer, I need a page object for the login page so test selectors and actions are centralized and maintainable.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/login.page.ts`
- [ ] Export `LoginPage` class with constructor accepting `Page` object
- [ ] Implement `emailInput` selector for email field
- [ ] Implement `passwordInput` selector for password field
- [ ] Implement `signInButton` selector for submit button
- [ ] Implement `errorMessage` selector for error display
- [ ] Implement `login(email, password)` method that fills form and submits
- [ ] Implement `isAtLoginPage()` method that checks URL/title
- [ ] Selectors use data-testid or role-based locators (not CSS classes)
- [ ] Typecheck passes

### US-002: Create onboarding page object
**Description:** As a developer, I need a page object for the Electron onboarding flow so desktop-specific setup can be tested.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/onboarding.page.ts`
- [ ] Export `OnboardingPage` class with constructor accepting `Page` object
- [ ] Implement `selectFolderButton` selector
- [ ] Implement `getStartedButton` selector
- [ ] Implement `libraryPathDisplay` selector
- [ ] Implement `isAtOnboardingPage()` method
- [ ] Typecheck passes

### US-003: Create auth fixture for test login
**Description:** As a developer, I need a reusable fixture that logs in as a test user so tests can skip manual login steps.

**Acceptance Criteria:**
- [ ] Create `e2e/fixtures/auth.fixture.ts`
- [ ] Export `test` that extends the base `test` from `app.fixture.ts`
- [ ] Add `authenticatedPage` fixture that logs in before each test
- [ ] Fixture uses `LoginPage` to perform login
- [ ] Default test user: `admin@localhost` / `password` (from seed data)
- [ ] Fixture verifies successful login by checking redirect to `/library`
- [ ] Session is automatically isolated per test (Playwright handles this)
- [ ] Typecheck passes

### US-004: Test successful login
**Description:** As a user, I want to log in with valid credentials so I can access my library.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/auth.spec.ts`
- [ ] Import `test` from `app.fixture.ts`
- [ ] Test navigates to `/login`
- [ ] Test enters valid credentials (`admin@localhost` / `password`)
- [ ] Test clicks sign-in button
- [ ] Test verifies redirect to `/library` page
- [ ] Test verifies "Alex" header or library content is visible
- [ ] Test passes on both `pnpm e2e:web` and `pnpm e2e:electron`
- [ ] Typecheck passes

### US-005: Test login with invalid credentials
**Description:** As a user, I should see an error when I enter invalid credentials so I know my login failed.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/auth.spec.ts`
- [ ] Test navigates to `/login`
- [ ] Test enters invalid credentials (wrong email or password)
- [ ] Test clicks sign-in button
- [ ] Test verifies error toast/message appears with "Invalid email or password"
- [ ] Test verifies user remains on `/login` page
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-006: Test logout
**Description:** As a user, I want to log out so I can secure my session.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/auth.spec.ts`
- [ ] Test uses `authenticatedPage` fixture to start logged in
- [ ] Test navigates to user menu/settings
- [ ] Test clicks logout/sign-out button
- [ ] Test verifies redirect to `/login` page
- [ ] Test verifies attempting to access `/library` redirects back to `/login`
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-007: Test session persistence
**Description:** As a user, I want my session to persist after refreshing the page so I don't have to log in repeatedly.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/auth.spec.ts`
- [ ] Test logs in successfully and lands on `/library`
- [ ] Test performs hard refresh (`page.reload()`)
- [ ] Test verifies still on `/library` without redirect to `/login`
- [ ] Test verifies user menu/session indicator still shows logged-in state
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-008: Test Electron desktop mode bypass (skip on web)
**Description:** As an Electron user, I should bypass the login page automatically since desktop mode has a synthetic session.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/auth.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'` using `test.skip()`
- [ ] Test navigates to `/login`
- [ ] Test verifies immediate redirect to `/library` without login form interaction
- [ ] Test verifies authenticated state (user menu shows admin)
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-009: Test first-run onboarding (Electron only, skip on web)
**Description:** As a first-time Electron user, I need to select my library folder before accessing the app.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/auth.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'` using `test.skip()`
- [ ] Test mocks Electron state where library path is not yet set
- [ ] Test verifies app shows onboarding page
- [ ] Test verifies "Select folder" button is present
- [ ] Note: Full onboarding flow requires IPC mocking (covered in Phase 6)
- [ ] For now, test verifies onboarding page renders correctly
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Login page object must centralize all login page selectors and actions
- FR-2: Auth fixture must provide `authenticatedPage` for tests needing logged-in state
- FR-3: All auth tests must run on both web and Electron platforms
- FR-4: Platform-specific tests (onboarding, desktop bypass) must be skipped on irrelevant platforms using `test.skip()`
- FR-5: Tests must verify both UI state (redirects, messages) and session state
- FR-6: Each test must start with a clean session (Playwright automatic isolation)
- FR-7: Tests must use role-based or data-testid selectors for stability
- FR-8: Login flow must support both valid and invalid credential scenarios
- FR-9: Session persistence must be verified via page reload

## Non-Goals

- No IPC mocking for full onboarding flow (Phase 6)
- No multi-user authentication scenarios (covered by integration tests if needed)
- No password reset or account recovery flows (features don't exist yet)
- No social login providers (not implemented)
- No testing of token refresh or expiration (out of scope)
- No visual regression testing of login page design

## Technical Considerations

- Login page uses NextAuth `signIn('credentials')` under the hood
- Electron desktop mode sets `NEXT_PUBLIC_ALEX_DESKTOP=true` which bypasses login UI
- Session cookies are httpOnly; can't inspect directly in tests
- Must verify session state via UI indicators (user menu, redirects)
- Default test user (`admin@localhost`) must exist in seed data (verify in future phase)
- Playwright automatically isolates cookies/storage between tests
- Onboarding flow uses `window.electronAPI` — full testing requires Electron context

## Success Metrics

- All auth tests pass on both `pnpm e2e:web` and `pnpm e2e:electron`
- Tests run in under 30 seconds total
- No flaky tests (100% pass rate on CI later)
- Code coverage for login page is >80% (via manual verification)
- Tests are readable and maintainable (each test under 20 lines)

## Open Questions

- Should we test login with SQL injection attempts or XSS payloads?
  - Recommendation: No, those are unit/security tests, not E2E UX tests
- Should we test CSRF protection on login form?
  - Recommendation: No, NextAuth handles this; trust framework unless issues arise
- Should we test session timeout/expiration?
  - Recommendation: Not in this phase; add if session timeout is a product requirement
