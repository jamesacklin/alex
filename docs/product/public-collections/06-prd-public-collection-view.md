# PRD: Public Collections - Public Collection View

## Introduction

Create the public-facing collection view page that anonymous users see when they visit a share link. This page displays collection metadata and a browsable grid of books, using the same lazy-load pagination pattern as the main library.

## Goals

- Display collection name, description, and books to anonymous users
- Provide a clean, focused interface without authenticated navigation
- Support lazy-load pagination with auto-scroll + Load More button
- Link to the public reader for each book
- Handle invalid share tokens gracefully (404 page)

## User Stories

### US-001: Create public collection page route
**Description:** As an anonymous user with a share link, I want to visit the URL and see the collection so I can browse the shared books.

**Acceptance Criteria:**
- [ ] Create `src/app/shared/[token]/page.tsx` (server component)
- [ ] Route is outside `(dashboard)` layout (no authenticated sidebar/nav)
- [ ] Fetch collection data from `GET /api/shared/[token]` or query DB directly
- [ ] Pass collection data and initial books to client component
- [ ] If token is invalid, render 404 page with message "Collection not found or no longer shared"
- [ ] Page includes basic meta tags (title, description) for SEO
- [ ] Typecheck passes

### US-002: Create minimal layout for public pages
**Description:** As a developer, I want a separate layout for public collection pages so they don't include authenticated navigation elements.

**Acceptance Criteria:**
- [ ] Create `src/app/shared/[token]/layout.tsx`
- [ ] Layout provides centered container with max-width (e.g., 1200px)
- [ ] Include minimal header with app name/logo
- [ ] No sidebar, no authenticated user menu
- [ ] Simple, clean design focused on content
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Display collection metadata
**Description:** As an anonymous user viewing a shared collection, I want to see the collection's name and description so I understand what the collection is about.

**Acceptance Criteria:**
- [ ] Create `src/app/shared/[token]/shared-collection-client.tsx` client component
- [ ] Display collection name as page heading (h1)
- [ ] Display collection description below the heading
- [ ] If description is empty, don't show empty space
- [ ] Show subtle "Shared collection" indicator (e.g., small badge or text)
- [ ] Include visual distinction from authenticated pages (no confusion about logged-in state)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Display books in responsive grid
**Description:** As an anonymous user viewing a shared collection, I want to see the books in a grid layout so I can browse them easily.

**Acceptance Criteria:**
- [ ] Display books in responsive grid (same layout as main library)
- [ ] Grid: 1 column on mobile, 2-3 on tablet, 4-6 on desktop
- [ ] Each book uses `SharedBookCard` component (see US-007)
- [ ] Grid updates when more books load (pagination)
- [ ] Empty state shown if collection has no books: "This collection is empty"
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Implement lazy-load pagination
**Description:** As an anonymous user viewing a large shared collection, I want books to load as I scroll so I can browse efficiently without long initial load times.

**Acceptance Criteria:**
- [ ] Use hybrid lazy-load pattern (auto-scroll + Load More button)
- [ ] Reuse `useInfiniteScroll` hook from main library implementation
- [ ] Sentinel element triggers auto-load when scrolling near bottom (400px threshold)
- [ ] "Load More" button shown when `hasMore` is true
- [ ] Clicking "Load More" fetches next page from `GET /api/shared/[token]?page=N`
- [ ] Books append to existing list (not replace)
- [ ] Show loading indicator while fetching
- [ ] Show "Showing X of Y books" count at bottom
- [ ] Debounce auto-scroll triggers (300ms)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Handle loading and error states
**Description:** As an anonymous user, I want to see appropriate feedback when the collection is loading or if an error occurs.

**Acceptance Criteria:**
- [ ] Show loading skeleton or spinner on initial page load
- [ ] Show "Loading more..." text when fetching additional pages
- [ ] If API error occurs, show error message: "Failed to load collection. Please try again."
- [ ] Include retry button on error state
- [ ] If token becomes invalid mid-session (e.g., owner disabled sharing), show clear message
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Create read-only book card component
**Description:** As a developer, I want a simplified book card for public view so it doesn't include authenticated features like collection management.

**Acceptance Criteria:**
- [ ] Create `src/components/library/SharedBookCard.tsx`
- [ ] Display cover image (from `coverUrl` prop: `/api/shared/{token}/covers/{bookId}`)
- [ ] Display title, author, file type badge, page count
- [ ] Link to public reader: `/shared/{token}/read/{bookId}`
- [ ] No collection management actions (no add/remove buttons)
- [ ] No context menu or dropdown
- [ ] Hover state shows the book is clickable
- [ ] Cover placeholder (SVG) shown if cover fails to load
- [ ] Accepts `shareToken` prop to construct public URLs
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Add minimal branding and navigation
**Description:** As an anonymous user viewing a shared collection, I want minimal navigation so I can understand where I am without being overwhelmed.

**Acceptance Criteria:**
- [ ] Header shows app name/logo (links to app homepage if public)
- [ ] Optional: "What is [App Name]?" link to marketing/info page
- [ ] No login button (not forcing users to sign up)
- [ ] Footer with minimal links (privacy policy, terms if applicable)
- [ ] Clean, uncluttered design
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: `/shared/[token]` must render collection name, description, and book grid
- FR-2: Page must use lazy-load pagination with auto-scroll + Load More button
- FR-3: Invalid tokens must show 404 page
- FR-4: Books must be displayed in responsive grid (1-6 columns)
- FR-5: Each book must link to `/shared/[token]/read/[bookId]`
- FR-6: Public pages must use separate layout (no authenticated navigation)
- FR-7: Page must show "Showing X of Y books" count
- FR-8: Pagination must fetch from `GET /api/shared/[token]?page=N`
- FR-9: SharedBookCard must accept `shareToken` and construct public URLs
- FR-10: Page must handle loading, error, and empty states

## Non-Goals (Out of Scope)

- No search or filtering (just show all books)
- No sorting options (use default collection order)
- No collection stats or metadata beyond name/description
- No "Download all" or bulk operations
- No social sharing buttons (just view and read)
- No comments or ratings on public collections

## Design Considerations

### Layout Without Dashboard Chrome
Public pages need to feel lightweight and focused:
- No sidebar (no navigation to other collections)
- Minimal header (just app branding)
- Centered content with generous whitespace
- Clear visual distinction from authenticated pages

### Book Card Design
SharedBookCard should be simpler than the authenticated BookCard:
- No collection management dropdowns
- No context menus
- Just cover, title, author, metadata
- Clear link affordance to the reader

### Pagination Strategy
Use the same lazy-load pattern as the main library because:
- Familiar implementation (reuse hooks and patterns)
- Good UX for large collections (auto-scroll)
- Fallback button for accessibility (Load More)
- Matches user's answer: "1A - Same hybrid pattern"

### 404 Handling
Invalid tokens should show a friendly 404:
- "Collection not found or no longer shared"
- Don't distinguish between "never existed" and "sharing disabled" (avoid leaking info)
- Optional: link to app homepage

## Technical Considerations

- Server component for initial page (can query DB directly if preferred over API fetch)
- Client component for pagination and interactivity
- Reuse `useInfiniteScroll` hook from `src/hooks/useInfiniteScroll.ts`
- Use Next.js dynamic routes: `[token]` segment
- Layout structure: `shared/[token]/layout.tsx` wraps `shared/[token]/page.tsx`
- TypeScript types for SharedBookCard props:
  ```typescript
  interface SharedBookCardProps {
    book: { id: string; title: string; author: string; fileType: string; pageCount: number; coverUrl: string }
    shareToken: string
  }
  ```
- Responsive grid using CSS Grid or Tailwind utilities
- Loading states managed with React state (isLoading, isLoadingMore)

## Success Metrics

- Anonymous users can view collections without authentication
- Pagination loads smoothly with auto-scroll and button fallback
- Book cards clearly link to the reader
- Page renders correctly on mobile, tablet, and desktop
- Invalid tokens show clear 404 message
- Initial load completes in under 2 seconds (reasonable collection size)
- Typecheck and lint pass with no errors

## Open Questions

- Should we show "Shared by [Username]"? (No - owner identity not exposed per plan)
- Should we add a "Create your own collection" CTA? (Optional - not required for MVP)
- Should empty collections show a CTA to the owner? (No - anonymous users can't contact owner)
