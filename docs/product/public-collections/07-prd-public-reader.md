# PRD: Public Collections - Public Reader

## Introduction

Create a public-facing book reader page that allows anonymous users to read PDFs and EPUBs from shared collections. The reader reuses existing PdfReader and EpubReader components but stores reading progress in localStorage instead of the server.

## Goals

- Allow anonymous users to read shared books without authentication
- Support both PDF and EPUB formats with full reader features
- Store reading progress in localStorage (client-side only)
- Provide seamless navigation back to the shared collection
- Maintain security by validating share tokens and book membership

## User Stories

### US-001: Create public reader page route
**Description:** As an anonymous user viewing a shared collection, I want to click on a book and read it in the browser without logging in.

**Acceptance Criteria:**
- [ ] Create `src/app/shared/[token]/read/[bookId]/page.tsx` (server component)
- [ ] Route is outside `(dashboard)` layout (no authenticated navigation)
- [ ] Validate share token and book membership on server (before rendering)
- [ ] If token invalid or book not in collection, show 404 page
- [ ] Fetch book metadata (title, fileType) to determine which reader to render
- [ ] Pass book data and public file URLs to client component
- [ ] Page includes meta tags (title with book name)
- [ ] Typecheck passes

### US-002: Render PDF reader for PDF books
**Description:** As an anonymous user reading a shared PDF, I want to use the PDF reader with all its features (navigation, zoom, search).

**Acceptance Criteria:**
- [ ] If book is PDF, render existing `PdfReader` component
- [ ] Pass `fileUrl` prop: `/api/shared/{token}/books/{bookId}/file`
- [ ] Pass `backUrl` prop: `/shared/{token}`
- [ ] Load initial progress from localStorage key: `shared-progress:{token}:{bookId}`
- [ ] On page change, save progress to localStorage with shape: `{ currentPage, totalPages, percentComplete }`
- [ ] Reader supports all existing features (zoom, search, page navigation)
- [ ] No server-side progress saves (anonymous users)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Render EPUB reader for EPUB books
**Description:** As an anonymous user reading a shared EPUB, I want to use the EPUB reader with all its features (chapter navigation, font size).

**Acceptance Criteria:**
- [ ] If book is EPUB, render existing `EpubReader` component
- [ ] Pass `fileUrl` prop: `/api/shared/{token}/books/{bookId}/book.epub`
- [ ] Pass `backUrl` prop: `/shared/{token}`
- [ ] Load initial progress from localStorage key: `shared-progress:{token}:{bookId}`
- [ ] On location change, save progress to localStorage with shape: `{ epubLocation, percentComplete }`
- [ ] Reader supports all existing features (font size, chapter nav, bookmarks)
- [ ] No server-side progress saves (anonymous users)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Add file URL prop to PdfReader component
**Description:** As a developer, I want to pass a custom file URL to PdfReader so the public reader can use the public file endpoint.

**Acceptance Criteria:**
- [ ] Modify `src/components/readers/PdfReader.tsx`
- [ ] Add optional `fileUrl` prop (string)
- [ ] If `fileUrl` provided, use it instead of `/api/books/${bookId}/file`
- [ ] Default to `/api/books/${bookId}/file` if not provided (backward compatible)
- [ ] Authenticated reader unchanged (doesn't pass prop)
- [ ] Typecheck passes

### US-005: Add file URL prop to EpubReader component
**Description:** As a developer, I want to pass a custom file URL to EpubReader so the public reader can use the public EPUB endpoint.

**Acceptance Criteria:**
- [ ] Modify `src/components/readers/EpubReader.tsx`
- [ ] Add optional `fileUrl` prop (string)
- [ ] If `fileUrl` provided, use it instead of `/api/books/${bookId}/book.epub`
- [ ] Default to `/api/books/${bookId}/book.epub` if not provided (backward compatible)
- [ ] Authenticated reader unchanged (doesn't pass prop)
- [ ] Typecheck passes

### US-006: Add back URL prop to reader components
**Description:** As a developer, I want to customize the "Back" button destination so the public reader returns to the shared collection instead of /library.

**Acceptance Criteria:**
- [ ] Modify `src/components/readers/PdfReader.tsx` to add optional `backUrl` prop
- [ ] Modify `src/components/readers/EpubReader.tsx` to add optional `backUrl` prop
- [ ] If `backUrl` provided, use it for the back button link
- [ ] Default to `/library` if not provided (backward compatible)
- [ ] Authenticated reader unchanged (doesn't pass prop)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Implement localStorage progress persistence
**Description:** As an anonymous user reading a shared book, I want my reading progress to persist when I reload the page so I can continue where I left off.

**Acceptance Criteria:**
- [ ] Progress stored in localStorage with key format: `shared-progress:{token}:{bookId}`
- [ ] PDF progress shape: `{ currentPage: number, totalPages: number, percentComplete: number }`
- [ ] EPUB progress shape: `{ epubLocation: string, percentComplete: number }`
- [ ] Progress loaded on page load (passed to reader as initial state)
- [ ] Progress saved immediately on page/location change (no debounce - minimal data)
- [ ] Progress persists across browser sessions (localStorage not sessionStorage)
- [ ] Progress does not sync across devices (client-side only)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Handle reader toolbar and controls
**Description:** As an anonymous user reading a shared book, I want the reader toolbar to work correctly with appropriate back navigation.

**Acceptance Criteria:**
- [ ] Reader toolbar shows book title
- [ ] "Back" button navigates to `/shared/{token}` (the shared collection)
- [ ] All reader controls work (zoom, page navigation, font size, etc.)
- [ ] No "Add to Collection" or other authenticated-only actions shown
- [ ] Fullscreen mode works if supported by existing readers
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-009: Handle loading and error states
**Description:** As an anonymous user, I want appropriate feedback when the book is loading or if an error occurs.

**Acceptance Criteria:**
- [ ] Show loading indicator while book file loads
- [ ] If file fails to load, show error message: "Failed to load book. Please try again."
- [ ] If token becomes invalid mid-read (owner disabled sharing), show clear message
- [ ] If book is removed from collection mid-read, handle gracefully
- [ ] Retry button on error state
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: `/shared/[token]/read/[bookId]` must render appropriate reader (PDF or EPUB)
- FR-2: PDF reader must load from `/api/shared/{token}/books/{bookId}/file`
- FR-3: EPUB reader must load from `/api/shared/{token}/books/{bookId}/book.epub`
- FR-4: Reading progress must be stored in localStorage only (no server saves)
- FR-5: Progress key format must be `shared-progress:{token}:{bookId}`
- FR-6: Progress must persist across page reloads in the same browser
- FR-7: "Back" button must navigate to `/shared/{token}` (the shared collection)
- FR-8: Invalid tokens or book membership must return 404
- FR-9: PdfReader and EpubReader must accept `fileUrl` and `backUrl` props
- FR-10: Authenticated readers must remain unchanged (backward compatible props)

## Non-Goals (Out of Scope)

- No server-side progress tracking for anonymous users
- No cross-device progress sync for anonymous users
- No "Create account to save progress" prompts (not forcing signup)
- No download button (files streamed to reader only)
- No annotation or highlighting features beyond what readers already support
- No reading time tracking or analytics

## Design Considerations

### Progress Persistence Strategy
Use localStorage instead of server because:
- No anonymous user records in database (security/privacy)
- Simpler implementation (no API calls)
- Adequate for public sharing use case (users can create account if they want sync)
- Per user's answer: "3A - LocalStorage only as described"

### Component Reusability
Make minimal changes to existing reader components:
- Add optional props (fileUrl, backUrl)
- Maintain backward compatibility (defaults to existing behavior)
- Authenticated readers don't pass props (no changes to their usage)
- Public reader passes props explicitly

This avoids duplicating complex reader logic.

### LocalStorage Key Format
Use `shared-progress:{token}:{bookId}` because:
- Namespaced to avoid conflicts with authenticated progress
- Token included so different shares of same book are independent
- Easy to clear if needed (user can delete localStorage entries)

### Back Navigation
The back button should return to the shared collection, not /library:
- Anonymous users don't have a library
- Preserves context (they came from the shared collection)
- Simple prop-based customization (backUrl)

## Technical Considerations

- Server component validates token/book before rendering (security)
- Client component handles reader state and progress
- localStorage API:
  ```typescript
  localStorage.setItem(key, JSON.stringify(progress))
  const progress = JSON.parse(localStorage.getItem(key) || 'null')
  ```
- PdfReader and EpubReader already accept `bookId` prop (used for progress keys)
- Progress update handlers already exist (onPageChange, onLocationChange)
- Public reader wraps existing components, passing custom props
- TypeScript types for props:
  ```typescript
  interface PdfReaderProps {
    bookId: string
    fileUrl?: string
    backUrl?: string
    initialProgress?: { currentPage: number; totalPages: number; percentComplete: number }
  }
  ```

## Success Metrics

- Anonymous users can read PDFs and EPUBs without authentication
- Reading progress persists across page reloads
- "Back" button returns to shared collection
- All reader features work (zoom, navigation, search, font size)
- Invalid tokens/books show clear 404 message
- No errors in browser console related to progress saving
- Typecheck and lint pass with no errors

## Open Questions

- Should we clear localStorage progress when a collection is no longer shared? (No - user might revisit, no harm in keeping)
- Should we add "Create account to save progress across devices" hint? (Not in MVP - avoid signup pressure)
- Should we limit localStorage progress entries to prevent bloat? (Not needed - progress data is tiny)
