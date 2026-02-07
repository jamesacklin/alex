# PRD: Phase 7 - Collections & Progress

## Introduction

Allow users to organize books into personal collections (shelves) and display reading progress prominently throughout the library interface. Includes a "Continue Reading" section for quick access to in-progress books. Users create all collections themselves—there are no system-created defaults.

## Goals

- Create, edit, and delete personal book collections
- Add and remove books from collections
- Display a "Continue Reading" section on the library page
- Show reading progress visually on book cards throughout the app

## User Stories

### US-7.1: Collections API
**Description:** As a developer, I need API endpoints for collection CRUD and book management.

**Acceptance Criteria:**
- [ ] `GET /api/collections` - list current user's collections with book counts
- [ ] `POST /api/collections` - create collection `{ name, description? }`
- [ ] `GET /api/collections/[id]` - get collection with its books
- [ ] `PUT /api/collections/[id]` - update collection `{ name?, description? }`
- [ ] `DELETE /api/collections/[id]` - delete collection (books not deleted)
- [ ] `POST /api/collections/[id]/books` - add book `{ bookId }`
- [ ] `DELETE /api/collections/[id]/books/[bookId]` - remove book
- [ ] All endpoints scoped to authenticated user
- [ ] Returns 404 if collection belongs to different user

### US-7.2: Collections Page
**Description:** As a user, I want to view and manage all my collections.

**Acceptance Criteria:**
- [ ] `src/app/(dashboard)/collections/page.tsx`
- [ ] Lists all user's collections as cards
- [ ] Each card shows: collection name, book count, description preview
- [ ] "New Collection" button in page header
- [ ] Click collection card to view its books
- [ ] Empty state: "You haven't created any collections yet"
- [ ] Verify in browser

### US-7.3: Create Collection Dialog
**Description:** As a user, I want to create new collections to organize my books.

**Acceptance Criteria:**
- [ ] "New Collection" button opens shadcn Dialog
- [ ] Form fields: Name (required), Description (optional textarea)
- [ ] Validation: name required, max 100 characters
- [ ] Cancel and Create buttons
- [ ] On success: close dialog, show success toast, refresh list
- [ ] On error: show error message in dialog
- [ ] Verify in browser

### US-7.4: Collection Detail View
**Description:** As a user, I want to view and manage books within a collection.

**Acceptance Criteria:**
- [ ] `src/app/(dashboard)/collections/[id]/page.tsx`
- [ ] Header: collection name, description, book count
- [ ] Edit button opens edit dialog (same form as create)
- [ ] Delete button with confirmation dialog
- [ ] Displays books in grid (reuse BookCard component)
- [ ] Each book card has "Remove from collection" option
- [ ] Empty state: "This collection is empty. Add books from your library."
- [ ] Verify in browser

### US-7.5: Add Book to Collection
**Description:** As a user, I want to add books to my collections from the library.

**Acceptance Criteria:**
- [ ] BookCard has three-dot menu (or right-click context menu)
- [ ] Menu option: "Add to Collection"
- [ ] Opens dialog listing all user's collections
- [ ] Checkmarks shown for collections book is already in
- [ ] Click collection to toggle (add or remove)
- [ ] Can select multiple collections
- [ ] "Done" button closes dialog
- [ ] Toast confirmation: "Added to [Collection Name]"
- [ ] Verify in browser

### US-7.6: Continue Reading Section
**Description:** As a user, I want quick access to books I'm currently reading.

**Acceptance Criteria:**
- [ ] Section at top of library page, above main grid
- [ ] Heading: "Continue Reading"
- [ ] Shows books where status = 'reading'
- [ ] Ordered by `lastReadAt` descending (most recent first)
- [ ] Displays maximum 6 books in horizontal scroll or row
- [ ] "See All" link if more than 6 books in progress
- [ ] Each card shows: cover, title, progress bar, "X% complete"
- [ ] Click card opens reader at saved position
- [ ] Hidden if no books are in progress
- [ ] Verify in browser

### US-7.7: Progress Display on Book Cards
**Description:** As a user, I want to see my reading progress on book cards throughout the app.

**Acceptance Criteria:**
- [ ] BookCard shows progress bar at bottom when progress exists
- [ ] Progress bar filled proportionally (0-100%)
- [ ] Percentage text below or inside bar (e.g., "42%")
- [ ] Not started: no progress bar shown
- [ ] Reading: colored progress bar (e.g., blue)
- [ ] Completed: full green bar with checkmark icon
- [ ] Progress visible on: Library grid, Collection views, Continue Reading
- [ ] Verify in browser

### US-7.8: Recently Read in Library
**Description:** As a user, I want the option to sort by recently read to find books I've been reading.

**Acceptance Criteria:**
- [ ] Sort option "Recently Read" in library filters
- [ ] Sorts by `lastReadAt` descending
- [ ] Books never opened appear at the end
- [ ] Works in combination with type/status filters
- [ ] Verify in browser

## Functional Requirements

- FR-7.1: Collections CRUD API (user-scoped, not shared)
- FR-7.2: Add/remove books from collections via API
- FR-7.3: Collections page with list view and create dialog
- FR-7.4: Collection detail page with book grid and edit/delete
- FR-7.5: "Add to Collection" menu on BookCard
- FR-7.6: "Continue Reading" section showing in-progress books
- FR-7.7: Progress bar display on BookCard component
- FR-7.8: "Recently Read" sort option in library
- FR-7.9: No default system collections—users create all

## Non-Goals

- No shared collections between users
- No public/discoverable collections
- No collection import/export
- No collection cover images
- No nested collections (folders within folders)

## Design Considerations

- Collection cards: simple card with name, count, description snippet
- "Add to Collection" dialog: checklist style with collection names
- Progress bar: thin bar (4px height) at bottom of book card
- Completed state: green bar with small checkmark
- Continue Reading: horizontal scrollable row on mobile

## Technical Considerations

- Collections are user-scoped via `userId` foreign key
- A book can exist in multiple collections (many-to-many)
- Deleting a collection removes `collection_books` entries but not books
- Progress data comes from `reading_progress` table joined with books
- "Continue Reading" query: `WHERE status = 'reading' ORDER BY lastReadAt DESC LIMIT 6`

## Success Metrics

- Users can create collections and add books within 3 clicks
- Continue Reading section loads quickly (<500ms)
- Progress display is accurate and updates after reading
- Collection deletion doesn't affect books or other collections

## Open Questions

- None - requirements are fully specified
