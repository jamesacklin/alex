# PRD: E2E Testing Phase 7 - CI/CD Workflow Integration

## Introduction

Integrate Playwright E2E tests into GitHub Actions CI/CD pipeline, running tests on all platforms (web, Electron on Linux/macOS/Windows) for every pull request and push to main. This phase ensures tests run automatically, capture artifacts on failure, and provide visibility into test results.

## Goals

- Create GitHub Actions workflow for E2E tests
- Configure test matrix for web and Electron on all three OS platforms
- Set up proper build and dependency steps for each platform
- Configure artifact uploads for test reports, traces, screenshots, and videos on failure
- Optimize workflow for performance and cost
- Ensure tests pass reliably in CI environment

## User Stories

### US-001: Create E2E workflow file
**Description:** As a developer, I need a GitHub Actions workflow that runs E2E tests automatically on PRs and pushes.

**Acceptance Criteria:**
- [ ] Create `.github/workflows/e2e.yml`
- [ ] Workflow triggers on `pull_request` to all branches
- [ ] Workflow triggers on `push` to `main` branch
- [ ] Workflow is named "E2E Tests"
- [ ] File matches pattern from `docs/product/testing/PLAN.md:196-295`
- [ ] Typecheck passes (YAML is valid)

### US-002: Configure web E2E job
**Description:** As a developer, I need a CI job that runs web-based E2E tests on Chromium.

**Acceptance Criteria:**
- [ ] Create `e2e-web` job in workflow
- [ ] Job runs on `ubuntu-latest`
- [ ] Job checks out code with `actions/checkout@v4`
- [ ] Job sets up pnpm with `pnpm/action-setup@v4`
- [ ] Job sets up Node.js 20 with cache using `actions/setup-node@v4`
- [ ] Job installs dependencies with `pnpm install --frozen-lockfile`
- [ ] Job installs Playwright browsers with `pnpm exec playwright install --with-deps chromium`
- [ ] Job installs native dependencies (Cairo, Pango, JPEG, GIF, RSVG) via `apt-get`
- [ ] Job builds native modules with `pnpm build:native`
- [ ] Job pushes database schema with `pnpm db:push`
- [ ] Job seeds database with `pnpm db:seed`
- [ ] Job runs tests with `pnpm exec playwright test --config=e2e/playwright.config.ts`
- [ ] Job sets `E2E_PLATFORM=web` and `DATABASE_PATH=./data/test.db` env vars
- [ ] Job uploads test report artifacts on failure with `actions/upload-artifact@v4`
- [ ] Artifact name is `e2e-web-report`
- [ ] Artifact path is `playwright-report/`
- [ ] All steps match pattern from `docs/product/testing/PLAN.md:206-227`

### US-003: Configure Electron Linux E2E job
**Description:** As a developer, I need a CI job that runs Electron E2E tests on Linux.

**Acceptance Criteria:**
- [ ] Create `e2e-electron-linux` job in workflow
- [ ] Job runs on `ubuntu-latest`
- [ ] Job follows same setup steps as web job (checkout, pnpm, Node.js, install deps)
- [ ] Job installs native dependencies via `apt-get`
- [ ] Job builds native modules with `pnpm build:native`
- [ ] Job builds Next.js app with `pnpm build`
- [ ] Job compiles Electron TypeScript with `npx tsc -p electron/tsconfig.json`
- [ ] Job pushes database schema and seeds data
- [ ] Job runs tests with `xvfb-run --auto-servernum pnpm exec playwright test --config=e2e/playwright.config.ts`
- [ ] `xvfb-run` is required on Linux for headless Electron (no display server)
- [ ] Job sets `E2E_PLATFORM=electron` and `DATABASE_PATH=./data/test.db` env vars
- [ ] Job uploads test report artifacts on failure
- [ ] Artifact name is `e2e-linux-report`
- [ ] All steps match pattern from `docs/product/testing/PLAN.md:229-250`

### US-004: Configure Electron macOS E2E job
**Description:** As a developer, I need a CI job that runs Electron E2E tests on macOS.

**Acceptance Criteria:**
- [ ] Create `e2e-electron-macos` job in workflow
- [ ] Job runs on `macos-latest`
- [ ] Job follows same setup steps (checkout, pnpm, Node.js, install deps)
- [ ] Job builds native modules with `pnpm build:native`
- [ ] Job builds Next.js app with `pnpm build`
- [ ] Job compiles Electron TypeScript with `npx tsc -p electron/tsconfig.json`
- [ ] Job pushes database schema and seeds data
- [ ] Job runs tests with `pnpm exec playwright test --config=e2e/playwright.config.ts`
- [ ] No `xvfb-run` needed on macOS (has native display server)
- [ ] Job sets `E2E_PLATFORM=electron` and `DATABASE_PATH=./data/test.db` env vars
- [ ] Job uploads test report artifacts on failure
- [ ] Artifact name is `e2e-macos-report`
- [ ] All steps match pattern from `docs/product/testing/PLAN.md:252-272`

### US-005: Configure Electron Windows E2E job
**Description:** As a developer, I need a CI job that runs Electron E2E tests on Windows.

**Acceptance Criteria:**
- [ ] Create `e2e-electron-windows` job in workflow
- [ ] Job runs on `windows-latest`
- [ ] Job follows same setup steps (checkout, pnpm, Node.js, install deps)
- [ ] Job builds native modules with `pnpm build:native`
- [ ] Job builds Next.js app with `pnpm build`
- [ ] Job compiles Electron TypeScript with `npx tsc -p electron/tsconfig.json`
- [ ] Job pushes database schema and seeds data
- [ ] Job runs tests with `pnpm exec playwright test --config=e2e/playwright.config.ts`
- [ ] No `xvfb-run` needed on Windows (has native display server)
- [ ] Job sets `E2E_PLATFORM=electron` and `DATABASE_PATH=./data/test.db` env vars
- [ ] Job uploads test report artifacts on failure
- [ ] Artifact name is `e2e-windows-report`
- [ ] All steps match pattern from `docs/product/testing/PLAN.md:274-294`

### US-006: Verify workflow runs on PR
**Description:** As a developer, I want to verify the workflow runs automatically when I open a PR.

**Acceptance Criteria:**
- [ ] Create a test PR with workflow file
- [ ] Verify all 4 jobs (web, Linux, macOS, Windows) start automatically
- [ ] Verify jobs appear in PR checks UI
- [ ] Verify jobs can run in parallel (no unnecessary dependencies)
- [ ] All jobs must pass for PR checks to be green

### US-007: Optimize workflow performance
**Description:** As a developer, I want CI runs to be fast and cost-effective.

**Acceptance Criteria:**
- [ ] Use pnpm cache via `actions/setup-node` cache parameter
- [ ] Use `--frozen-lockfile` to ensure reproducible installs
- [ ] Jobs run in parallel (no sequential dependencies)
- [ ] Artifacts only upload on failure to save storage
- [ ] Playwright retries configured (2 retries in CI) to reduce false failures
- [ ] Workers set to 1 for SQLite safety (already configured in playwright.config.ts)

### US-008: Document workflow behavior
**Description:** As a developer, I need documentation explaining how the CI workflow works.

**Acceptance Criteria:**
- [ ] Add comments to workflow file explaining key steps
- [ ] Document `xvfb-run` requirement for Linux in workflow comments
- [ ] Document native dependency installation in workflow comments
- [ ] Add notes to `docs/product/testing/PLAN.md` if workflow deviates from plan

## Functional Requirements

- FR-1: Workflow must trigger on pull requests to all branches and pushes to main
- FR-2: Workflow must run 4 jobs: web (Linux), Electron (Linux, macOS, Windows)
- FR-3: Each job must install dependencies, build app, compile Electron, reset/seed DB, and run tests
- FR-4: Linux Electron job must use `xvfb-run` for headless execution
- FR-5: macOS and Windows jobs must not use `xvfb-run` (native display servers)
- FR-6: All jobs must set `E2E_PLATFORM` and `DATABASE_PATH` environment variables
- FR-7: Test reports (traces, screenshots, videos) must upload as artifacts on failure
- FR-8: Workflow must use pnpm cache for faster installs
- FR-9: Jobs must run in parallel when possible
- FR-10: Playwright retries must be enabled (2 retries in CI)

## Non-Goals

- No manual approval gates (tests run automatically)
- No test result commenting on PRs (can add later if needed)
- No test coverage reporting (not implemented yet)
- No performance benchmarking in CI
- No cross-browser testing (web only runs on Chromium)
- No deployment steps (this is test-only workflow)

## Technical Considerations

- GitHub Actions ubuntu-latest has no display server; `xvfb-run` provides virtual framebuffer
- macOS and Windows runners have native display servers (Aqua, Windows DWM)
- Native dependencies (Cairo, Pango, JPEG, GIF, RSVG) required for image processing
- Electron requires compiling TypeScript from `electron/` directory before running
- Database path must be set to test database (`./data/test.db`) to avoid conflicts
- Playwright automatically installs browsers on first run; `--with-deps` installs system dependencies
- Test artifacts (reports) can be large; only upload on failure to save GitHub storage quota
- Workers set to 1 due to SQLite single-writer constraint (already in playwright.config.ts)

## Success Metrics

- Workflow runs successfully on first PR after implementation
- All 4 jobs (web, Linux, macOS, Windows) pass on main branch
- CI run time is under 15 minutes per platform (total ~60 minutes for all 4 jobs in parallel)
- No flaky tests in CI (100% pass rate on retries)
- Artifact uploads work correctly on test failures
- PR checks block merging when tests fail

## Open Questions

- Should we cache Playwright browsers to speed up CI?
  - Recommendation: Yes, use `actions/cache` for `~/.cache/ms-playwright`
- Should we run tests on Firefox/WebKit in addition to Chromium?
  - Recommendation: Start with Chromium only; add others if needed later
- Should we split web and Electron tests into separate workflows?
  - Recommendation: No, keep in one workflow for simplicity; jobs run in parallel anyway
- Should we add a job that combines all test results into one report?
  - Recommendation: Defer; GitHub Actions UI shows all job results already
