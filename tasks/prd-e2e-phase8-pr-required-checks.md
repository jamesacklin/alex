# PRD: E2E Testing Phase 8 - PR Required Checks

## Introduction

Wire E2E tests into GitHub repository branch protection rules, making them required checks before merging PRs. This phase ensures all E2E tests (web, Electron on Linux/macOS/Windows) must pass before code can be merged to main, preventing regressions from reaching production.

## Goals

- Configure GitHub branch protection for main branch
- Add E2E test jobs as required status checks
- Verify PR merge is blocked when tests fail
- Verify PR merge is allowed when tests pass
- Document required check configuration for maintainers
- Optional: Configure auto-merge when all checks pass

## User Stories

### US-001: Enable branch protection on main
**Description:** As a maintainer, I need branch protection enabled on the main branch to prevent accidental direct pushes.

**Acceptance Criteria:**
- [ ] Navigate to repository Settings → Branches
- [ ] Add branch protection rule for `main` branch
- [ ] Enable "Require a pull request before merging"
- [ ] Enable "Require status checks to pass before merging"
- [ ] Enable "Require branches to be up to date before merging"
- [ ] Optional: Enable "Require linear history"
- [ ] Branch protection rule is active

### US-002: Add E2E web job as required check
**Description:** As a maintainer, I need the E2E web job to be a required check so PRs cannot merge if web tests fail.

**Acceptance Criteria:**
- [ ] In branch protection rule, add required status check: `e2e-web`
- [ ] Job name matches the job name in `.github/workflows/e2e.yml`
- [ ] Verify check appears in PR UI after running workflow
- [ ] Verify PR merge button is blocked until `e2e-web` passes
- [ ] Branch protection rule saves successfully

### US-003: Add E2E Electron Linux job as required check
**Description:** As a maintainer, I need the E2E Electron Linux job to be a required check.

**Acceptance Criteria:**
- [ ] In branch protection rule, add required status check: `e2e-electron-linux`
- [ ] Job name matches the job name in `.github/workflows/e2e.yml`
- [ ] Verify check appears in PR UI
- [ ] Verify PR merge button is blocked until `e2e-electron-linux` passes
- [ ] Branch protection rule saves successfully

### US-004: Add E2E Electron macOS job as required check
**Description:** As a maintainer, I need the E2E Electron macOS job to be a required check.

**Acceptance Criteria:**
- [ ] In branch protection rule, add required status check: `e2e-electron-macos`
- [ ] Job name matches the job name in `.github/workflows/e2e.yml`
- [ ] Verify check appears in PR UI
- [ ] Verify PR merge button is blocked until `e2e-electron-macos` passes
- [ ] Branch protection rule saves successfully

### US-005: Add E2E Electron Windows job as required check
**Description:** As a maintainer, I need the E2E Electron Windows job to be a required check.

**Acceptance Criteria:**
- [ ] In branch protection rule, add required status check: `e2e-electron-windows`
- [ ] Job name matches the job name in `.github/workflows/e2e.yml`
- [ ] Verify check appears in PR UI
- [ ] Verify PR merge button is blocked until `e2e-electron-windows` passes
- [ ] Branch protection rule saves successfully

### US-006: Verify PR merge is blocked when tests fail
**Description:** As a developer, I should not be able to merge a PR when E2E tests fail.

**Acceptance Criteria:**
- [ ] Create a test PR that intentionally breaks a test (e.g., change expected text)
- [ ] Push to PR and wait for E2E workflow to run
- [ ] Verify at least one E2E job fails
- [ ] Verify PR merge button shows "Merging is blocked" or "Required checks failed"
- [ ] Verify PR cannot be merged via UI or API
- [ ] Fix the test and verify PR becomes mergeable after tests pass

### US-007: Verify PR merge is allowed when all tests pass
**Description:** As a developer, I should be able to merge a PR when all E2E tests pass.

**Acceptance Criteria:**
- [ ] Create a test PR with no breaking changes
- [ ] Push to PR and wait for E2E workflow to run
- [ ] Verify all 4 E2E jobs pass (web, Linux, macOS, Windows)
- [ ] Verify PR merge button shows "Merge pull request" (green, enabled)
- [ ] Verify PR can be merged via UI or API
- [ ] Merge PR successfully

### US-008: Document required check configuration
**Description:** As a maintainer, I need documentation explaining how branch protection and required checks are configured.

**Acceptance Criteria:**
- [ ] Add section to `docs/product/testing/PLAN.md` explaining required checks
- [ ] Document which jobs are required: `e2e-web`, `e2e-electron-linux`, `e2e-electron-macos`, `e2e-electron-windows`
- [ ] Document how to add/remove required checks in GitHub settings
- [ ] Document what happens when a required check fails (PR blocked)
- [ ] Document how to bypass checks (admin override, if enabled)

### US-009: Optional - Configure auto-merge when checks pass
**Description:** As a developer, I want PRs to auto-merge when all required checks pass and approvals are met.

**Acceptance Criteria:**
- [ ] Enable "Require approvals" in branch protection (e.g., 1 approval required)
- [ ] Developer enables auto-merge on a PR
- [ ] When all required checks pass and approvals are met, PR merges automatically
- [ ] Verify auto-merge works correctly
- [ ] Document auto-merge behavior in testing docs

## Functional Requirements

- FR-1: Branch protection must be enabled on `main` branch
- FR-2: Required status checks must include all 4 E2E jobs: `e2e-web`, `e2e-electron-linux`, `e2e-electron-macos`, `e2e-electron-windows`
- FR-3: PR merge must be blocked when any required E2E job fails
- FR-4: PR merge must be allowed when all required E2E jobs pass
- FR-5: Check names in branch protection must exactly match job names in workflow file
- FR-6: Documentation must explain how to configure and manage required checks
- FR-7: Optional: Auto-merge can be enabled for PRs when all checks pass

## Non-Goals

- No custom status check reporting (use GitHub native checks)
- No Slack/email notifications for failed checks (can add later if needed)
- No test result aggregation or dashboards (use GitHub Actions UI)
- No bypass mechanism for developers (only admins can override if enabled)
- No separate checks for unit tests or linting (out of scope, focus on E2E only)

## Technical Considerations

- Required status checks are configured per branch in repository settings
- Check names must exactly match job names in workflow YAML (case-sensitive)
- If workflow is renamed or jobs are renamed, required checks must be updated
- Branch protection can allow admins to bypass checks (optional, not recommended)
- "Require branches to be up to date" forces rebasing before merge (prevents stale PRs)
- Auto-merge requires additional approval rules and "Allow auto-merge" setting
- GitHub Actions checks appear as separate status checks in PR UI
- Failed checks show detailed logs and artifact links in PR checks tab

## Success Metrics

- Branch protection is active on main branch
- All 4 E2E jobs are required status checks
- Test PR with failing tests is blocked from merging
- Test PR with passing tests can merge successfully
- Documentation is clear and complete
- No accidental merges of PRs with failing E2E tests

## Open Questions

- Should we allow admins to bypass required checks in emergencies?
  - Recommendation: Yes, but log all overrides; use only for critical hotfixes
- Should we require code review approvals in addition to E2E checks?
  - Recommendation: Yes, at least 1 approval recommended for main branch
- Should we enable auto-merge by default or require opt-in per PR?
  - Recommendation: Opt-in per PR; developers can choose when to use it
- Should we add separate lint/typecheck required checks?
  - Recommendation: Yes, but as separate workflow; keep E2E workflow focused on E2E tests only
