# PRD: E2E Testing Phase 5 - Collections and Progress Tests

## Introduction

Implement end-to-end tests for Alex's collections feature and reading progress tracking. This phase validates creating, editing, and deleting collections, adding/removing books, sharing collections via public links, and verifying that multiple users can track independent reading progress on the same book.

## Goals

- Create page object models for collections pages
- Write comprehensive tests for collection CRUD operations
- Test adding and removing books from collections
- Test public collection sharing via token links
- Test multi-user reading progress independence
- Ensure tests pass on both web and Electron platforms

## User Stories

### US-001: Create collections page object
**Description:** As a developer, I need a page object for the collections list page so test selectors and actions are centralized.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/collections.page.ts`
- [ ] Export `CollectionsPage` class with constructor accepting `Page` object
- [ ] Implement `createCollectionButton` selector
- [ ] Implement `collectionCards` selector (returns all visible collection cards)
- [ ] Implement `collectionCardByName(name)` method
- [ ] Implement `filterDropdown` selector (all/private/shared)
- [ ] Implement `createCollectionDialog` selector
- [ ] Implement `collectionNameInput` selector
- [ ] Implement `collectionDescriptionInput` selector
- [ ] Implement `saveCollectionButton` selector
- [ ] Implement `deleteCollectionButton(name)` selector
- [ ] Implement `shareCollectionButton(name)` selector
- [ ] Implement `copyShareLinkButton` selector
- [ ] Implement `clickCollection(name)` method (navigates to detail)
- [ ] Implement `filterBy(filter)` method (all/private/shared)
- [ ] Typecheck passes

### US-002: Create collection detail page object
**Description:** As a developer, I need a page object for the collection detail page so test selectors and actions are centralized.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/collection-detail.page.ts`
- [ ] Export `CollectionDetailPage` class with constructor accepting `Page` object
- [ ] Implement `collectionTitle` selector
- [ ] Implement `collectionDescription` selector
- [ ] Implement `addBooksButton` selector
- [ ] Implement `bookCards` selector (returns all books in collection)
- [ ] Implement `removeBookButton(bookTitle)` selector
- [ ] Implement `addBooksDialog` selector
- [ ] Implement `availableBooks` selector (books not yet in collection)
- [ ] Implement `addBookToCollection(bookTitle)` method
- [ ] Implement `removeBookFromCollection(bookTitle)` method
- [ ] Implement `getBookCount()` method
- [ ] Typecheck passes

### US-003: Test create new collection
**Description:** As a user, I want to create a new collection so I can organize my books.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/collections.spec.ts`
- [ ] Import `test` from `auth.fixture.ts`
- [ ] Test navigates to `/collections`
- [ ] Test clicks "Create Collection" button
- [ ] Test fills in collection name (e.g., "Science Fiction")
- [ ] Test fills in description (optional)
- [ ] Test clicks "Save" or "Create" button
- [ ] Test verifies new collection appears in list
- [ ] Test verifies collection name matches input
- [ ] Test passes on both `pnpm e2e:web` and `pnpm e2e:electron`
- [ ] Typecheck passes

### US-004: Test edit collection
**Description:** As a user, I want to edit a collection's name or description.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test creates a collection first (or uses existing from seed)
- [ ] Test clicks edit button on collection card
- [ ] Test changes collection name to "Updated Name"
- [ ] Test changes description
- [ ] Test saves changes
- [ ] Test verifies updated name appears in list
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-005: Test delete collection
**Description:** As a user, I want to delete a collection when I no longer need it.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test creates a collection first
- [ ] Test clicks delete button on collection card
- [ ] Test confirms deletion in dialog
- [ ] Test verifies collection is removed from list
- [ ] Test verifies books are not deleted (only collection)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-006: Test add books to collection
**Description:** As a user, I want to add books to a collection to organize them.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test creates a new collection
- [ ] Test opens collection detail page
- [ ] Test clicks "Add Books" button
- [ ] Test selects 2 books from available books list
- [ ] Test confirms addition
- [ ] Test verifies both books appear in collection detail
- [ ] Test verifies book count updates (e.g., "2 books")
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-007: Test remove books from collection
**Description:** As a user, I want to remove books from a collection without deleting them from my library.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test opens a collection that has 2+ books
- [ ] Test clicks "Remove" button on one book
- [ ] Test confirms removal
- [ ] Test verifies book is removed from collection detail
- [ ] Test verifies book count decrements (e.g., from 2 to 1)
- [ ] Test navigates back to library and verifies book still exists
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-008: Test share collection (generate public link)
**Description:** As a user, I want to share a collection via a public link so others can view it without logging in.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test creates a collection with 1+ books
- [ ] Test clicks "Share" button on collection card
- [ ] Test verifies share token is generated
- [ ] Test copies share link (e.g., `/shared/{token}`)
- [ ] Test verifies collection card shows "Shared" badge/indicator
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-009: Test shared collection is accessible without auth
**Description:** As a visitor, I want to view a shared collection via public link without logging in.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test creates and shares a collection (as authenticated user)
- [ ] Test copies share link
- [ ] Test logs out or uses new incognito context (no auth)
- [ ] Test navigates to shared link (e.g., `/shared/abc123`)
- [ ] Test verifies collection name and books are visible
- [ ] Test verifies no authentication is required
- [ ] Test verifies books cannot be removed (read-only)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-010: Test unshare collection (revoke public link)
**Description:** As a user, I want to revoke a public share link to make a collection private again.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test shares a collection (generates token)
- [ ] Test clicks "Unshare" or "Make Private" button
- [ ] Test confirms action
- [ ] Test verifies "Shared" badge is removed
- [ ] Test verifies attempting to access previous share link returns 404 or unauthorized
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-011: Test filter collections (all/private/shared)
**Description:** As a user, I want to filter collections by sharing status to focus on private or shared ones.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/collections.spec.ts`
- [ ] Test creates 1 private and 1 shared collection
- [ ] Test selects "Shared" filter
- [ ] Test verifies only shared collection is visible
- [ ] Test selects "Private" filter
- [ ] Test verifies only private collection is visible
- [ ] Test selects "All" filter
- [ ] Test verifies both collections are visible
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-012: Test multi-user reading progress independence
**Description:** As a user, I want my reading progress to be independent from other users reading the same book.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/progress.spec.ts`
- [ ] Import `test` from `auth.fixture.ts`
- [ ] Test logs in as User A (e.g., `admin@localhost`)
- [ ] Test opens a PDF and navigates to page 5
- [ ] Test waits for progress save
- [ ] Test logs out
- [ ] Test logs in as User B (e.g., `user@localhost`)
- [ ] Test opens the same PDF
- [ ] Test verifies PDF starts at page 1 (not page 5)
- [ ] Test navigates to page 10
- [ ] Test waits for progress save
- [ ] Test logs out
- [ ] Test logs in as User A again
- [ ] Test opens the same PDF
- [ ] Test verifies PDF resumes at page 5 (User A's saved progress)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-013: Test reading progress saves to API
**Description:** As a developer, I want to verify reading progress is saved to the API endpoint.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/progress.spec.ts`
- [ ] Test opens a PDF and navigates to page 3
- [ ] Test waits for progress save debounce (~2 seconds)
- [ ] Test calls `GET /api/books/{bookId}/progress` via fetch
- [ ] Test verifies API response shows `currentPage: 3`
- [ ] Test verifies `percentComplete` is correct (e.g., 60% if 5 pages total)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-014: Test progress survives page reload
**Description:** As a user, I want my reading progress to persist after refreshing the page.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/progress.spec.ts`
- [ ] Test opens a PDF and navigates to page 4
- [ ] Test waits for progress save
- [ ] Test performs hard refresh (`page.reload()`)
- [ ] Test verifies PDF still shows page 4 (not page 1)
- [ ] Test verifies progress bar matches 80% (if 5 pages total)
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Collections page object must centralize all collection list selectors and actions
- FR-2: Collection detail page object must centralize book management selectors
- FR-3: Tests must verify collection CRUD (create, read, update, delete) operations
- FR-4: Tests must verify adding and removing books from collections
- FR-5: Tests must verify share token generation and public link access
- FR-6: Tests must verify unsharing revokes public access
- FR-7: Tests must verify filter by sharing status (all/private/shared)
- FR-8: Tests must verify reading progress is independent per user
- FR-9: Tests must verify progress saves to API (`PUT /api/books/[id]/progress`)
- FR-10: Tests must verify progress persists after page reload
- FR-11: All tests must pass on both web and Electron platforms

## Non-Goals

- No testing of collection sorting (not implemented)
- No testing of collection search (not implemented)
- No testing of nested collections or subcollections (not supported)
- No testing of collection permissions/ownership beyond public sharing
- No testing of progress sync across devices (not implemented)
- No testing of progress conflict resolution (not needed with per-user tracking)

## Technical Considerations

- Collections API endpoints: `GET/POST /api/collections`, `GET/PUT/DELETE /api/collections/[id]`
- Shared collection endpoint: `GET /api/shared/[token]` (no auth required)
- Adding books to collection: `POST /api/collections/[id]/books` with `{ bookId }`
- Removing books: `DELETE /api/collections/[id]/books/[bookId]`
- Share token is generated server-side and stored in `collections.shareToken`
- Reading progress is stored in `readingProgress` table with unique constraint on `(userId, bookId)`
- Progress API endpoint: `PUT /api/books/[id]/progress`
- Multi-user tests require seeding 2+ users in `global-setup.ts`
- Shared collections must be read-only (no add/remove buttons for unauthenticated users)

## Success Metrics

- All collections and progress tests pass on both `pnpm e2e:web` and `pnpm e2e:electron`
- Tests run in under 90 seconds total
- No flaky tests (100% pass rate)
- Multi-user progress test verifies isolation correctly
- Tests are readable and maintainable (each test under 30 lines)

## Open Questions

- Should we test collection pagination if a user has 100+ collections?
  - Recommendation: Not in this phase; low priority
- Should we test progress tracking for audiobooks (if added later)?
  - Recommendation: Wait until feature is implemented
- Should we test collection export/import?
  - Recommendation: Not implemented yet; defer
