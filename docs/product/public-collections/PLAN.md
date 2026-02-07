# Plan: Public Collections

## Summary

Allow a logged-in user to share a collection of books with anyone via a URL. Recipients can browse the collection, view book metadata, and read books (PDF and EPUB) directly in the browser — all without creating an account or logging in.

---

## Design Decisions

### Share token vs. public flag

Use a **share token** (random, unguessable string) rather than a simple boolean `isPublic` flag. Reasons:

- The collection UUID is sequential/predictable enough that a boolean flag would let anyone enumerate public collections.
- A token can be revoked and regenerated without changing the collection's ID.
- The URL becomes `/shared/<token>` — short, opaque, and unlinkable to internal IDs.

### What the public view exposes

The public view provides **read-only access to collection content**:

- Collection name and description
- Book title, author, cover image, page count, file type
- Full PDF reader (page navigation, zoom, search)
- Full EPUB reader (chapter navigation, font size settings)
- Reading progress stored in the browser (localStorage) — no server-side tracking for anonymous users
- The owner's identity is not exposed (no email, display name, or user ID)

### What the public view does NOT expose

- Direct file download links (files are streamed to the reader only)
- Any editing, adding, or removing books from the collection
- Any user-specific server-side data (reading progress, other collections, user accounts)
- The book's internal ID in the URL (public reader routes use `shareToken + bookId` scoping)

### Anonymous reading progress

Authenticated users get server-side reading progress stored in the database. Anonymous public viewers get **client-side progress via localStorage** instead:

- Key format: `shared-progress:<shareToken>:<bookId>`
- Stores the same shape: `{ currentPage, totalPages, percentComplete }` for PDFs, `{ epubLocation, percentComplete }` for EPUBs
- No server round-trips, no database writes, no anonymous user records
- Progress persists across page reloads in the same browser but is not synced across devices

---

## Implementation Steps

### 1. Database: add share token columns to `collections`

**File:** `src/lib/db/schema.ts`

Add two columns to the `collections` table:

```ts
shareToken: text("share_token").unique(),   // nullable — null means private
sharedAt:   integer("shared_at"),           // timestamp when sharing was enabled
```

- `shareToken` is `null` by default (collection is private).
- When a user enables sharing, generate a `crypto.randomUUID()` and store it in `shareToken`, set `sharedAt` to current timestamp.
- When a user disables sharing, set `shareToken` back to `null`.

**Migration:** Generate a new Drizzle migration (`pnpm drizzle-kit generate`). Since these are nullable columns on an existing table, no data loss.

### 2. API: toggle sharing on a collection

**File:** `src/app/api/collections/[id]/share/route.ts` (new)

#### `POST /api/collections/[id]/share` — enable sharing

- Requires authentication (existing session check pattern).
- Verify ownership (`collections.userId === session.user.id`).
- Generate `crypto.randomUUID()` token and store it in `shareToken`.
- Set `sharedAt` to `Math.floor(Date.now() / 1000)`.
- Return `{ shareToken, shareUrl }` where `shareUrl` is `${NEXTAUTH_URL}/shared/${shareToken}`.

#### `DELETE /api/collections/[id]/share` — disable sharing

- Requires authentication and ownership verification.
- Set `shareToken = null`, `sharedAt = null`.
- Return `{ success: true }`.

#### `GET /api/collections/[id]/share` — check share status

- Requires authentication and ownership verification.
- Return `{ isShared: boolean, shareToken: string | null, sharedAt: number | null }`.

### 3. API: public collection endpoint (unauthenticated)

**File:** `src/app/api/shared/[token]/route.ts` (new)

#### `GET /api/shared/[token]` — fetch public collection data

- **No authentication required.**
- Look up the collection by `shareToken`.
- If not found, return `404`.
- Return the collection metadata and paginated book list.
- Supports `?page` and `?limit` query params for pagination.

Response shape:

```json
{
  "collection": {
    "name": "My Reading List",
    "description": "Books I recommend"
  },
  "books": [
    {
      "id": "...",
      "title": "...",
      "author": "...",
      "fileType": "pdf",
      "pageCount": 320,
      "coverUrl": "/api/shared/<token>/covers/<bookId>"
    }
  ],
  "total": 42,
  "page": 1,
  "totalPages": 2,
  "hasMore": true
}
```

### 4. API: public cover image endpoint (unauthenticated)

**File:** `src/app/api/shared/[token]/covers/[bookId]/route.ts` (new)

#### `GET /api/shared/[token]/covers/[bookId]`

- **No authentication required.**
- Validate the token and verify the book belongs to the shared collection.
- Serve the cover image (same logic as existing `/api/books/[id]/cover`, including SVG placeholder fallback).
- This prevents unauthenticated users from accessing covers for books not in the shared collection.

### 5. API: public file serving endpoint (unauthenticated)

**File:** `src/app/api/shared/[token]/books/[bookId]/file/route.ts` (new)

#### `GET /api/shared/[token]/books/[bookId]/file`

- **No authentication required.**
- Validate the token and verify the book belongs to the shared collection.
- Stream the book file with HTTP range request support (same logic as existing `/api/books/[id]/file`).
- Set correct `Content-Type` (`application/pdf` or `application/epub+zip`).
- Support `Range` header for PDF.js streaming.

**File:** `src/app/api/shared/[token]/books/[bookId]/book.epub/route.ts` (new)

#### `GET /api/shared/[token]/books/[bookId]/book.epub`

- **No authentication required.**
- Validate the token and verify the book belongs to the shared collection.
- Serve the EPUB file as an ArrayBuffer (same logic as existing `/api/books/[id]/book.epub`).
- The `.epub` extension in the route is required because `react-reader` (epubjs) expects a URL ending in `.epub`.

### 6. Shared API helper: token + book validation

**File:** `src/lib/shared.ts` (new)

Extract a reusable helper used by all public API routes:

```ts
/** Look up a collection by share token. Returns null if not found/not shared. */
export async function getSharedCollection(token: string)

/** Verify a book belongs to a shared collection. Returns the book row or null. */
export async function getSharedBook(token: string, bookId: string)
```

This avoids duplicating the token-lookup + book-membership check across four public endpoints (collection, cover, file, epub).

### 7. Middleware: allow public routes

**File:** `src/middleware.ts`

Add exceptions for the public share routes so they bypass authentication:

```ts
// Public shared collection pages and API
if (nextUrl.pathname.startsWith("/shared/") || nextUrl.pathname.startsWith("/api/shared/")) {
  return NextResponse.next();
}
```

Place this check early in the middleware, alongside the existing `/login` and `/setup` exemptions.

### 8. Frontend: share toggle UI in collection detail

**File:** `src/app/(dashboard)/collections/[id]/collection-detail-client.tsx`

Add a "Share" button to the collection detail header (next to the existing Edit and Delete buttons):

- If the collection is not shared: show a "Share" button that calls `POST /api/collections/[id]/share`.
- If the collection is shared: show the share URL in a copyable input field, with a "Copy Link" button and a "Stop Sharing" button that calls `DELETE /api/collections/[id]/share`.
- Use a `Dialog` (consistent with the existing edit dialog pattern) to present sharing options.

Changes to existing data flow:
- The `GET /api/collections/[id]` response should include `shareToken` and `sharedAt` so the UI knows the current share state. Add these two fields to the collection select in the existing route handler.

### 9. Frontend: public collection view page

**File:** `src/app/shared/[token]/page.tsx` (new)

This is a **server component** page outside the `(dashboard)` layout group, so it renders without the authenticated sidebar/nav.

- Fetch collection data from the internal API (or query DB directly since it's a server component).
- Display collection name, description, and a responsive grid of book cards.
- Book cards show cover image, title, author, file type badge, and page count.
- Each book card links to the public reader at `/shared/<token>/read/<bookId>`.
- Include pagination ("Load More" button) matching the existing collection detail pattern.
- Minimal branding: show the app name and a note like "Shared collection" in the header.
- If the token is invalid, show a 404 page.

**File:** `src/app/shared/[token]/layout.tsx` (new)

A minimal layout without the dashboard sidebar. Basic centered container with a max-width.

**File:** `src/app/shared/[token]/shared-collection-client.tsx` (new)

Client component for pagination and interactivity (same pattern as `collection-detail-client.tsx`, but read-only — no edit/delete/remove actions).

### 10. Frontend: public reader page

**File:** `src/app/shared/[token]/read/[bookId]/page.tsx` (new)

A public reader page that mirrors the authenticated reader at `/read/[bookId]` but:

- **No authentication required.** Does not redirect to `/login`.
- Validates the share token and book membership before rendering.
- Loads the book file from the public endpoint (`/api/shared/<token>/books/<bookId>/file` for PDF, `/api/shared/<token>/books/<bookId>/book.epub` for EPUB).
- The "Back" button navigates to the shared collection page (`/shared/<token>`) instead of `/library`.
- Reading progress is loaded from and saved to **localStorage** instead of the server.

This page reuses the existing `PdfReader` and `EpubReader` components. These components accept:
- A file URL (configurable — point to the public endpoints)
- An `onPageChange` / `onLocationChange` callback (redirect to localStorage writes)
- Initial progress state (load from localStorage)

The components themselves require no modifications. Only the page wrapper changes how it provides the file URL and handles progress.

### 11. Component: read-only book card for public view

**File:** `src/components/library/SharedBookCard.tsx` (new)

A simpler book card component for the public collection view. The existing `BookCard` has collection-management logic (add/remove from collections) and links to the authenticated reader that would be invasive to modify. `SharedBookCard`:

- Renders cover image (via the public cover URL), title, author, file type badge, page count.
- Links to the public reader (`/shared/<token>/read/<bookId>`).
- No context menu, no collection actions.
- Accepts `coverUrl` as a prop (since the public cover endpoint has a different path than the authenticated one).

### 12. Reader components: minor adjustments

**Files:** `src/components/readers/PdfReader.tsx`, `src/components/readers/EpubReader.tsx`

The existing reader components are already mostly generic. Minor adjustments needed:

- The `PdfReader` currently hardcodes the file URL as `/api/books/${bookId}/file`. Add a `fileUrl` prop so the public page can pass `/api/shared/<token>/books/<bookId>/file` instead. Fall back to the existing default if not provided.
- The `EpubReader` currently fetches from `/api/books/${bookId}/book.epub`. Same change — add a `fileUrl` prop.
- The back-to-library link in both reader toolbars is currently hardcoded to `/library`. Add a `backUrl` prop (default: `/library`) so the public page can pass `/shared/<token>`.

These are additive, backward-compatible prop additions — no changes to how the authenticated reader works.

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/lib/db/schema.ts` | Modify | Add `shareToken` and `sharedAt` columns to `collections` |
| `src/lib/db/migrations/` | Generate | New migration for the schema change |
| `src/lib/shared.ts` | Create | Helper functions for token validation and book membership |
| `src/middleware.ts` | Modify | Allow `/shared/*` and `/api/shared/*` without auth |
| `src/app/api/collections/[id]/route.ts` | Modify | Include `shareToken`/`sharedAt` in GET response |
| `src/app/api/collections/[id]/share/route.ts` | Create | POST/DELETE/GET for share toggle |
| `src/app/api/shared/[token]/route.ts` | Create | Public collection data endpoint |
| `src/app/api/shared/[token]/covers/[bookId]/route.ts` | Create | Public cover image endpoint |
| `src/app/api/shared/[token]/books/[bookId]/file/route.ts` | Create | Public book file streaming endpoint |
| `src/app/api/shared/[token]/books/[bookId]/book.epub/route.ts` | Create | Public EPUB file endpoint |
| `src/app/(dashboard)/collections/[id]/collection-detail-client.tsx` | Modify | Add share button and share dialog |
| `src/app/shared/[token]/page.tsx` | Create | Public collection view page |
| `src/app/shared/[token]/layout.tsx` | Create | Minimal layout for public view |
| `src/app/shared/[token]/shared-collection-client.tsx` | Create | Client component for public collection view |
| `src/app/shared/[token]/read/[bookId]/page.tsx` | Create | Public reader page (PDF + EPUB) |
| `src/components/library/SharedBookCard.tsx` | Create | Read-only book card for public view |
| `src/components/readers/PdfReader.tsx` | Modify | Add `fileUrl` and `backUrl` props |
| `src/components/readers/EpubReader.tsx` | Modify | Add `fileUrl` and `backUrl` props |

---

## Route Map

### Authenticated (existing, unchanged)

| Route | Purpose |
|-------|---------|
| `/collections` | User's collections list |
| `/collections/[id]` | Collection detail with edit/delete/share controls |
| `/read/[bookId]` | Book reader (progress saved server-side) |
| `/api/collections/[id]` | Collection CRUD |
| `/api/books/[id]/file` | Book file streaming |
| `/api/books/[id]/book.epub` | EPUB file serving |
| `/api/books/[id]/cover` | Book cover image |
| `/api/books/[id]/progress` | Reading progress CRUD |

### Authenticated (new)

| Route | Purpose |
|-------|---------|
| `/api/collections/[id]/share` | Share toggle (POST/DELETE/GET) |

### Public / unauthenticated (new)

| Route | Purpose |
|-------|---------|
| `/shared/[token]` | Public collection view page |
| `/shared/[token]/read/[bookId]` | Public book reader |
| `/api/shared/[token]` | Public collection data |
| `/api/shared/[token]/covers/[bookId]` | Public cover image |
| `/api/shared/[token]/books/[bookId]/file` | Public book file streaming |
| `/api/shared/[token]/books/[bookId]/book.epub` | Public EPUB file |

---

## Security Considerations

1. **Token unguessability:** UUIDv4 tokens have 122 bits of randomness — sufficient for share links.
2. **Book scoping:** Every public endpoint validates that the requested book belongs to the shared collection. A valid share token cannot be used to access books outside that collection.
3. **No direct download links:** Files are streamed to the in-browser reader. There is no `/download` endpoint. (A technically sophisticated user could still save the streamed content, but this is comparable to right-click-save on any web content.)
4. **Ownership verification:** Only the collection owner can enable/disable sharing.
5. **No user data leakage:** The public response omits the owner's userId, email, and display name.
6. **No anonymous server state:** Anonymous readers' progress is stored in localStorage only. No anonymous user records are created in the database, eliminating a class of abuse vectors (storage exhaustion, tracking concerns).
7. **Rate limiting:** Not in scope for this plan, but could be added later to the public endpoints if abuse becomes a concern.

---

## Out of Scope

- Direct file download buttons for public viewers
- Password-protected shared collections
- Expiring share links
- Per-book sharing (only whole collections)
- Public collection discovery/listing
- Analytics on shared collection views
- Rate limiting on public endpoints
- Cross-device progress sync for anonymous users

These could be built as follow-up features if needed.
