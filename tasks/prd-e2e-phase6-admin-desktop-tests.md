# PRD: E2E Testing Phase 6 - Admin and Desktop-Specific Tests

## Introduction

Implement end-to-end tests for Alex's admin panel (user management, library settings) and Electron desktop-specific features (system tray, IPC for library path selection, window management, onboarding). This phase includes platform-specific tests that only run on Electron or for admin users.

## Goals

- Create page object models for admin pages
- Write tests for user management (create, edit, delete users)
- Write tests for admin-only library settings
- Test Electron system tray functionality
- Test Electron IPC operations (library path selection, rescan)
- Test Electron onboarding flow
- Test Electron window show/hide/minimize behavior
- Ensure all tests properly skip on irrelevant platforms

## User Stories

### US-001: Create admin users page object
**Description:** As a developer, I need a page object for the admin users page so test selectors and actions are centralized.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/admin-users.page.ts`
- [ ] Export `AdminUsersPage` class with constructor accepting `Page` object
- [ ] Implement `addUserButton` selector
- [ ] Implement `userTable` selector
- [ ] Implement `userRowByEmail(email)` method
- [ ] Implement `editUserButton(email)` selector
- [ ] Implement `deleteUserButton(email)` selector
- [ ] Implement `createUserDialog` selector
- [ ] Implement `emailInput` selector
- [ ] Implement `displayNameInput` selector
- [ ] Implement `passwordInput` selector
- [ ] Implement `roleSelect` selector (admin/user)
- [ ] Implement `saveUserButton` selector
- [ ] Implement `deleteConfirmButton` selector
- [ ] Implement `createUser(email, displayName, password, role)` method
- [ ] Implement `deleteUser(email)` method
- [ ] Typecheck passes

### US-002: Create admin library page object
**Description:** As a developer, I need a page object for the admin library settings page.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/admin-library.page.ts`
- [ ] Export `AdminLibraryPage` class with constructor accepting `Page` object
- [ ] Implement `libraryPathDisplay` selector (Electron only)
- [ ] Implement `changeLibraryPathButton` selector (Electron only)
- [ ] Implement `rescanLibraryButton` selector (Electron only)
- [ ] Implement `clearLibraryButton` selector
- [ ] Implement `clearConfirmDialog` selector
- [ ] Implement `resetAppButton` selector (Electron only)
- [ ] Implement `resetConfirmDialog` selector (Electron only)
- [ ] Implement `clickClearLibrary()` method
- [ ] Implement `clickResetApp()` method (Electron only)
- [ ] Typecheck passes

### US-003: Test admin can create users
**Description:** As an admin, I want to create new users so they can access the library.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/admin.spec.ts`
- [ ] Import `test` from `auth.fixture.ts` (logged in as admin)
- [ ] Test navigates to `/admin/users`
- [ ] Test clicks "Add User" button
- [ ] Test fills in email (e.g., `newuser@localhost`)
- [ ] Test fills in display name (e.g., "New User")
- [ ] Test fills in password (e.g., `password123`)
- [ ] Test selects role (e.g., "user")
- [ ] Test clicks "Save" or "Create" button
- [ ] Test verifies new user appears in user table
- [ ] Test passes on both `pnpm e2e:web` and `pnpm e2e:electron`
- [ ] Typecheck passes

### US-004: Test admin can edit users
**Description:** As an admin, I want to edit user details like display name or role.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/admin.spec.ts`
- [ ] Test creates a user first (or uses existing from seed)
- [ ] Test clicks edit button on user row
- [ ] Test changes display name to "Updated Name"
- [ ] Test changes role from "user" to "admin"
- [ ] Test saves changes
- [ ] Test verifies updated name and role appear in table
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-005: Test admin can delete users
**Description:** As an admin, I want to delete users who no longer need access.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/admin.spec.ts`
- [ ] Test creates a user first
- [ ] Test clicks delete button on user row
- [ ] Test confirms deletion in dialog
- [ ] Test verifies user is removed from table
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-006: Test non-admin cannot access admin routes
**Description:** As a regular user, I should not be able to access admin pages.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/admin.spec.ts`
- [ ] Test logs in as regular user (not admin, e.g., `user@localhost`)
- [ ] Test attempts to navigate to `/admin/users`
- [ ] Test verifies redirect to `/library` or 403/unauthorized page
- [ ] Test verifies admin UI is not visible
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-007: Test admin library path setting is visible on Electron only
**Description:** As an Electron admin, I should see library path settings; as a web admin, I should not.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/admin.spec.ts`
- [ ] Test navigates to `/admin/library`
- [ ] When `E2E_PLATFORM=electron`: verify "Library Directory" section is visible
- [ ] When `E2E_PLATFORM=web`: verify "Library Directory" section is hidden
- [ ] Test passes on both platforms with correct visibility
- [ ] Typecheck passes

### US-008: Test clear library (web and Electron)
**Description:** As an admin, I want to clear all books from the library database.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/admin.spec.ts`
- [ ] Test navigates to `/admin/library`
- [ ] Test clicks "Clear Library" button
- [ ] Test confirms action in dialog
- [ ] Test waits for operation to complete (toast or success message)
- [ ] Test navigates to `/library`
- [ ] Test verifies all books are removed (empty state)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-009: Test Electron system tray icon appears (skip on web)
**Description:** As an Electron user, I should see a system tray icon for quick access to the app.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/desktop.spec.ts`
- [ ] Import `test` from `app.fixture.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'` using `test.skip()`
- [ ] Test launches Electron app
- [ ] Test verifies system tray icon exists (via Electron API or visual check)
- [ ] Note: Full tray interaction may require mocking; verify icon creation for now
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-010: Test Electron tray menu options (skip on web)
**Description:** As an Electron user, I want to access app functions via the tray menu.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/desktop.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'`
- [ ] Test clicks system tray icon (if accessible)
- [ ] Test verifies tray menu contains "Show Alex", "Change Library Folder", "Quit Alex"
- [ ] Note: Full tray testing may be limited by Playwright; document any limitations
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-011: Test Electron library path selection via IPC (skip on web)
**Description:** As an Electron admin, I want to change the library directory via a native file dialog.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/desktop.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'`
- [ ] Test navigates to `/admin/library`
- [ ] Test clicks "Change Directory" button
- [ ] Test mocks IPC response (e.g., `window.electronAPI.selectLibraryPath()` returns `/mock/path`)
- [ ] Test verifies success toast or message
- [ ] Note: Native dialog cannot be automated; mock IPC response
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-012: Test Electron rescan library triggers file watcher (skip on web)
**Description:** As an Electron admin, I want to manually trigger a library rescan.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/desktop.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'`
- [ ] Test navigates to `/admin/library`
- [ ] Test clicks "Restart Watcher" or "Rescan Library" button
- [ ] Test verifies success toast or loading indicator
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-013: Test Electron window close minimizes to tray (skip on web)
**Description:** As an Electron user, I want the app to minimize to tray when I close the window.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/desktop.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'`
- [ ] Test closes window (via `window.close()` or BrowserWindow API)
- [ ] Test verifies window is hidden but app is still running (tray icon exists)
- [ ] Note: Behavior depends on Electron app config; verify expected behavior
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-014: Test Electron onboarding flow completes (skip on web)
**Description:** As a first-time Electron user, I should complete onboarding by selecting a library folder.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/desktop.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'`
- [ ] Test mocks state where library path is not set (fresh install)
- [ ] Test verifies onboarding page loads
- [ ] Test mocks `window.electronAPI.selectLibraryPathInitial()` to return `/mock/library`
- [ ] Test clicks "Get Started" button
- [ ] Test mocks `window.electronAPI.completeOnboarding()` to return `{ success: true }`
- [ ] Test verifies redirect to `/library`
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

### US-015: Test Electron reset app (skip on web)
**Description:** As an Electron admin, I want to reset the app to factory settings and return to onboarding.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/desktop.spec.ts`
- [ ] Test is skipped when `E2E_PLATFORM !== 'electron'`
- [ ] Test navigates to `/admin/library`
- [ ] Test clicks "Reset App" button
- [ ] Test confirms action in dialog
- [ ] Test mocks `window.electronAPI.resetApp()` to return `{ success: true }`
- [ ] Test verifies redirect to `/onboarding`
- [ ] Test passes when run with `pnpm e2e:electron`
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Admin page objects must centralize all admin panel selectors and actions
- FR-2: Tests must verify admin users can create, edit, and delete other users
- FR-3: Tests must verify non-admin users cannot access admin routes
- FR-4: Tests must verify library path settings are Electron-only
- FR-5: Tests must verify clear library works on both web and Electron
- FR-6: Desktop-specific tests must be skipped on web using `test.skip()`
- FR-7: Electron tests must verify system tray icon creation
- FR-8: Electron tests must verify IPC operations (library path, rescan, reset)
- FR-9: Electron tests must verify window show/hide/minimize behavior
- FR-10: Electron tests must verify onboarding flow completes successfully
- FR-11: IPC operations should be mocked where native dialogs are involved

## Non-Goals

- No testing of tray icon visual appearance (only existence)
- No testing of native file dialog interaction (cannot be automated)
- No testing of OS-specific window manager integration
- No testing of app auto-update or version checking
- No testing of multi-window scenarios (app is single-window)
- No testing of Electron DevTools or internal Electron APIs

## Technical Considerations

- Admin routes use middleware to check `session.user.role === 'admin'`
- Non-admin access to admin routes should return 403 or redirect to `/library`
- Electron IPC calls use `window.electronAPI` (defined in `preload.ts`)
- Native file dialogs (`dialog.showOpenDialog`) cannot be automated; must mock IPC
- System tray is created in `electron/tray.ts` using `new Tray(icon)`
- Tray menu interactions may be limited by Playwright Electron support
- Onboarding flow checks `window.electronAPI.getLibraryPath()` on mount
- Reset app clears library path, books, and covers; then reloads to `/onboarding`
- Window close behavior is configurable; default may quit or minimize to tray

## Success Metrics

- All admin and desktop tests pass on their respective platforms
- Platform-specific tests are properly skipped on irrelevant platforms
- No flaky tests (100% pass rate)
- IPC mocking works correctly for Electron-only operations
- Tests are readable and maintainable (each test under 30 lines)

## Open Questions

- Can Playwright fully automate Electron tray interactions?
  - Recommendation: Document limitations; test tray creation only if full interaction is not supported
- Should we test window resize or fullscreen mode?
  - Recommendation: Not in this phase; low priority
- Should we test Electron menu bar (File, Edit, View)?
  - Recommendation: Not implemented yet; defer
- How should we mock Electron IPC in tests?
  - Recommendation: Use `page.evaluate()` to override `window.electronAPI` methods with mocks
