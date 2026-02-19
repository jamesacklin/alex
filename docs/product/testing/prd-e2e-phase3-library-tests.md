# PRD: E2E Testing Phase 3 - Library Tests

## Introduction

Implement end-to-end tests for Alex's library page, validating book display, search, filtering, sorting, lazy-load pagination, and navigation. This phase also includes setting up database seeding and test fixture files (sample PDFs and EPUBs) to ensure predictable test data.

## Goals

- Create database seeding helpers for test isolation
- Add sample PDF and EPUB fixture files for testing
- Create library page object model with selectors and actions
- Write comprehensive tests covering all library features
- Verify lazy-load pagination and real-time updates (SSE)
- Ensure tests pass on both web and Electron platforms

## User Stories

### US-001: Create test database helpers
**Description:** As a developer, I need database reset and seed helpers so each test run starts with predictable data.

**Acceptance Criteria:**
- [ ] Create `e2e/helpers/db.ts`
- [ ] Implement `resetDatabase()` function that truncates all tables
- [ ] Implement `seedDatabase()` function that inserts test users and books
- [ ] Seed at least 3 test books: 1 PDF, 1 EPUB, 1 more (any type)
- [ ] Each book has title, author, fileType, cover, and filePath
- [ ] Seed 1 admin user (`admin@localhost`) and 1 regular user (`user@localhost`)
- [ ] Functions use the same database connection as the app (`db` from `@/lib/db`)
- [ ] Typecheck passes

### US-002: Create test fixture files
**Description:** As a developer, I need small sample PDF and EPUB files so tests can verify file handling without large downloads.

**Acceptance Criteria:**
- [ ] Create `e2e/helpers/fixtures/` directory
- [ ] Add `sample.pdf` (< 100 KB, 1-2 pages, readable text)
- [ ] Add `sample.epub` (< 100 KB, minimal content)
- [ ] Add cover images for each book (PNG/JPG, < 50 KB each)
- [ ] Files are committed to git (small enough to not bloat repo)
- [ ] Fixtures are referenced in `seedDatabase()` function

### US-003: Update global setup to seed database
**Description:** As a developer, I need the global setup to reset and seed the database before each test run so tests have clean data.

**Acceptance Criteria:**
- [ ] Update `e2e/global-setup.ts`
- [ ] Call `resetDatabase()` before seeding
- [ ] Call `seedDatabase()` to populate test data
- [ ] Log "Database reset and seeded" on success
- [ ] Handle errors gracefully with clear error messages
- [ ] Typecheck passes

### US-004: Create library page object
**Description:** As a developer, I need a page object for the library page so test selectors and actions are centralized.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/library.page.ts`
- [ ] Export `LibraryPage` class with constructor accepting `Page` object
- [ ] Implement `searchInput` selector
- [ ] Implement `typeFilter` dropdown selector (all/pdf/epub)
- [ ] Implement `statusFilter` dropdown selector (all/now-reading)
- [ ] Implement `sortDropdown` selector (added/title/author)
- [ ] Implement `bookCards` selector (returns all visible book cards)
- [ ] Implement `bookCardByTitle(title)` method
- [ ] Implement `getBookCount()` method (returns number of visible books)
- [ ] Implement `search(query)` method
- [ ] Implement `filterByType(type)` method
- [ ] Implement `filterByStatus(status)` method
- [ ] Implement `sortBy(field)` method
- [ ] Implement `clickBook(title)` method (navigates to reader)
- [ ] Implement `loadMoreButton` selector
- [ ] Implement `clickLoadMore()` method
- [ ] Implement `getLoadingState()` method (checks for skeleton loaders)
- [ ] Typecheck passes

### US-005: Test library displays books after seeding
**Description:** As a user, I want to see my books displayed in the library when I visit it.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/library.spec.ts`
- [ ] Import `test` from `auth.fixture.ts` (to start authenticated)
- [ ] Test navigates to `/library`
- [ ] Test verifies at least 3 books are displayed (from seed data)
- [ ] Test verifies each book card has a title and cover image
- [ ] Test passes on both `pnpm e2e:web` and `pnpm e2e:electron`
- [ ] Typecheck passes

### US-006: Test search filters books by title
**Description:** As a user, I want to search for books by title so I can quickly find what I'm looking for.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test starts on `/library` with all books visible
- [ ] Test enters search query matching one book title
- [ ] Test waits for debounce and results to update
- [ ] Test verifies only matching book(s) are displayed
- [ ] Test verifies non-matching books are hidden
- [ ] Test clears search and verifies all books return
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-007: Test filter by file type (PDF/EPUB)
**Description:** As a user, I want to filter books by file type so I can focus on PDFs or EPUBs separately.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test starts with all books visible
- [ ] Test selects "PDF" filter from type dropdown
- [ ] Test verifies only PDF books are displayed
- [ ] Test selects "EPUB" filter
- [ ] Test verifies only EPUB books are displayed
- [ ] Test selects "All" filter
- [ ] Test verifies all books return
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-008: Test sort by title, author, date added
**Description:** As a user, I want to sort books by different fields so I can organize my library view.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test sorts by title (A-Z) and verifies order
- [ ] Test sorts by author and verifies order
- [ ] Test sorts by date added (newest first) and verifies order
- [ ] Verification uses book titles/authors from known seed data
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-009: Test empty state renders correctly
**Description:** As a user, I should see an empty state message when no books match my filters.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test applies a search query that matches no books (e.g., "nonexistent12345")
- [ ] Test verifies empty state message is displayed
- [ ] Test verifies message says something like "No books found" or similar
- [ ] Test verifies no book cards are rendered
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-010: Test book card click navigates to reader
**Description:** As a user, I want to click a book to open it in the reader.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test clicks on a known book card by title
- [ ] Test verifies navigation to `/read/[bookId]`
- [ ] Test verifies reader page loads (title visible)
- [ ] Test does not need to fully test reader functionality (Phase 4)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-011: Test lazy-load pagination (Load More button)
**Description:** As a user, I want to load more books when I scroll or click "Load More" so I can browse large libraries efficiently.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test seeds enough books to trigger pagination (e.g., 30+ books via helper)
- [ ] Test verifies initial page shows subset (e.g., 20 books)
- [ ] Test verifies "Load More" button is visible
- [ ] Test clicks "Load More" button
- [ ] Test verifies additional books are appended (not replaced)
- [ ] Test verifies total count increases correctly
- [ ] Test verifies "Load More" disappears when all books loaded
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-012: Test filter/search resets pagination
**Description:** As a user, when I change filters or search, the page should reset to page 1 with new results.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/library.spec.ts`
- [ ] Test loads page 2 via "Load More"
- [ ] Test changes search query or filter
- [ ] Test verifies results reset to page 1
- [ ] Test verifies previous page 2 results are cleared
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Database must reset and seed before each test run via `global-setup.ts`
- FR-2: Seed data must include at least 3 books with predictable titles/authors
- FR-3: Fixture files (sample PDF, EPUB) must be small (< 100 KB each) and valid
- FR-4: Library page object must centralize all selectors for book cards, filters, search, and pagination
- FR-5: Tests must verify search, type filter, status filter, and sorting work correctly
- FR-6: Tests must verify empty state appears when no books match filters
- FR-7: Tests must verify clicking a book navigates to reader page
- FR-8: Tests must verify lazy-load pagination appends results correctly
- FR-9: Tests must verify changing filters/search resets pagination to page 1
- FR-10: All tests must pass on both web and Electron platforms

## Non-Goals

- No testing of SSE real-time updates (complex, out of scope for now)
- No testing of "Now Reading" section (focus on main library grid)
- No testing of collection filtering (Phase 5)
- No testing of bulk actions or multi-select (features don't exist)
- No performance testing of large libraries (1000+ books)
- No visual regression testing of book card design

## Technical Considerations

- Library uses lazy-load pagination with `hasMore` boolean flag
- Search and filters update URL query params (e.g., `?q=query&type=pdf`)
- Filters trigger debounced API calls with AbortController for cancellation
- Books are fetched from `/api/books?page=1&limit=20&q=...&type=...&sort=...`
- SSE updates are handled via `/api/library/events` (skip testing for now)
- Database must use SQLite test database path (e.g., `./data/test.db`)
- Seed data must match actual schema in `src/lib/db/schema.ts`
- Book cards use `BookCard` component — selectors should target consistent structure

## Success Metrics

- All library tests pass on both `pnpm e2e:web` and `pnpm e2e:electron`
- Tests run in under 60 seconds total
- No flaky tests (100% pass rate)
- Database seeding completes in < 1 second
- Tests are readable and maintainable (each test under 30 lines)
- Seed data is predictable and minimal (no excessive test books)

## Open Questions

- Should we test keyboard navigation (arrow keys, tab order)?
  - Recommendation: Not in this phase; add if accessibility becomes a priority
- Should we test URL query param persistence (bookmarkable filters)?
  - Recommendation: Yes, but low priority; can verify URL includes query params
- How many books should we seed for pagination tests?
  - Recommendation: 30 books (to trigger 2 pages with limit=20)
