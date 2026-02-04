# PRD: Phase 4 - Library UI

## Introduction

Build the main library browsing interface with a responsive book grid, search functionality, filtering, sorting, and the API endpoints to support it. This is the primary view users interact with after logging in.

## Goals

- Display books with covers in a responsive grid layout
- Search books by title and author
- Filter by file type (PDF/ePub) and reading status
- Sort by title, author, date added, or last read
- Provide a consistent dashboard layout with navigation

## User Stories

### US-4.1: Books List API
**Description:** As a frontend, I need an API to fetch books with filtering, sorting, and pagination.

**Acceptance Criteria:**
- [ ] `GET /api/books` endpoint
- [ ] Query params: `q` (search), `type` (pdf|epub|all), `status` (all|not_started|reading|completed), `sort` (title|author|added|read), `page`, `limit`
- [ ] Returns: `{ books: [...], total: number, page: number, totalPages: number }`
- [ ] Each book includes: id, title, author, coverPath, fileType, pageCount, and user's reading progress
- [ ] Default sort: recently added (descending)
- [ ] Default limit: 24 books per page

### US-4.2: Single Book API
**Description:** As a frontend, I need to fetch details for a single book.

**Acceptance Criteria:**
- [ ] `GET /api/books/[id]` endpoint
- [ ] Returns full book details including all metadata
- [ ] Includes user's reading progress (or null if not started)
- [ ] Returns 404 with error message if book not found

### US-4.3: Book Cover API
**Description:** As a frontend, I need to fetch book cover images efficiently.

**Acceptance Criteria:**
- [ ] `GET /api/books/[id]/cover` endpoint
- [ ] Streams cover image from `data/covers/[id].jpg`
- [ ] Returns placeholder image if no cover exists
- [ ] Sets `Cache-Control: public, max-age=86400` header
- [ ] Sets correct `Content-Type` header

### US-4.4: Dashboard Layout
**Description:** As a user, I need a consistent layout with navigation across all dashboard pages.

**Acceptance Criteria:**
- [ ] `src/app/(dashboard)/layout.tsx`
- [ ] Sidebar navigation with: Library, Collections, Admin (visible only if admin)
- [ ] Header with app name/logo, user avatar dropdown (profile info, logout)
- [ ] Responsive: sidebar collapses to hamburger menu on mobile (<768px)
- [ ] Active nav item highlighted
- [ ] Verify in browser

### US-4.5: Library Page
**Description:** As a user, I want to browse my book library with search and filters.

**Acceptance Criteria:**
- [ ] `src/app/(dashboard)/library/page.tsx`
- [ ] Displays books in responsive grid (4 cols desktop, 2 cols tablet, 1 col mobile)
- [ ] Search bar at top of page
- [ ] Filter dropdowns: Type (All/PDF/ePub), Status (All/Not Started/Reading/Completed)
- [ ] Sort dropdown: Title A-Z, Author A-Z, Recently Added, Recently Read
- [ ] Pagination controls at bottom
- [ ] Loading skeleton while fetching
- [ ] Empty state when no books match filters
- [ ] Verify in browser

### US-4.6: Book Card Component
**Description:** As a user, I want to see book information at a glance on each card.

**Acceptance Criteria:**
- [ ] `src/components/library/BookCard.tsx`
- [ ] Shows cover image with aspect ratio maintained (2:3 book ratio)
- [ ] Placeholder image if no cover
- [ ] Title (truncated to 2 lines if long)
- [ ] Author name (truncated to 1 line)
- [ ] File type badge (PDF or EPUB) in corner
- [ ] Progress bar at bottom if reading (shows percentage)
- [ ] Click anywhere on card navigates to `/read/[bookId]`
- [ ] Hover state with slight elevation/shadow
- [ ] Verify in browser

### US-4.7: Search Functionality
**Description:** As a user, I want to search for books by title or author.

**Acceptance Criteria:**
- [ ] Search input in library page header
- [ ] Debounced API call (300ms delay after typing stops)
- [ ] Searches both title and author fields (case-insensitive)
- [ ] Updates URL with `?q=searchterm` param
- [ ] Clear button (X) appears when text entered
- [ ] Pressing Enter or clicking search icon triggers immediate search
- [ ] Verify in browser

### US-4.8: Filter and Sort Controls
**Description:** As a user, I want to filter and sort my book list.

**Acceptance Criteria:**
- [ ] `src/components/library/BookFilters.tsx`
- [ ] Type filter dropdown with options: All, PDF, ePub
- [ ] Status filter dropdown with options: All, Not Started, Reading, Completed
- [ ] Sort dropdown with options: Title A-Z, Author A-Z, Recently Added, Recently Read
- [ ] Filters persist in URL params (`?type=pdf&status=reading&sort=title`)
- [ ] Filters combine (e.g., PDF + Reading shows only PDFs being read)
- [ ] Clear filters button when any filter is active
- [ ] Verify in browser

## Functional Requirements

- FR-4.1: Books API with search, filter, sort, and pagination support
- FR-4.2: Single book API with 404 handling
- FR-4.3: Cover image serving with caching and placeholder fallback
- FR-4.4: Dashboard layout with responsive sidebar navigation
- FR-4.5: Book grid with responsive columns (4/2/1)
- FR-4.6: Book cards showing cover, title, author, type, progress
- FR-4.7: Debounced search with URL persistence
- FR-4.8: Filter by type and reading status
- FR-4.9: Sort by title, author, date added, date last read

## Non-Goals

- No infinite scroll (use pagination)
- No drag-and-drop organization
- No bulk selection or operations
- No list view (grid only for now)

## Design Considerations

- Book cards: 2:3 aspect ratio for covers (standard book proportion)
- Grid gaps: 24px on desktop, 16px on mobile
- Sidebar width: 240px on desktop
- Use shadcn Select for filter dropdowns
- Use shadcn Input with search icon for search
- Skeleton: match BookCard dimensions exactly

## Technical Considerations

- Use React Query or SWR for data fetching with caching
- Debounce search input to reduce API calls
- Store all filter/sort state in URL search params for shareability
- Use `next/image` for cover images with optimization
- Consider prefetching next page for smoother pagination

## Success Metrics

- Library page loads and displays books within 1 second
- Search returns results as user types (after debounce)
- Filters work correctly in combination
- Pagination works for libraries with many books
- Mobile layout is usable and touch-friendly

## Open Questions

- None - requirements are fully specified
