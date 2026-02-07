# Plan: Public Collections

## Summary

Allow a logged-in user to share a collection with anyone via a URL. Recipients can view the collection's book list (titles, authors, covers, descriptions) without creating an account or logging in.

---

## Design Decisions

### Share token vs. public flag

Use a **share token** (random, unguessable string) rather than a simple boolean `isPublic` flag. Reasons:

- The collection UUID is sequential/predictable enough that a boolean flag would let anyone enumerate public collections.
- A token can be revoked and regenerated without changing the collection's ID.
- The URL becomes `/shared/<token>` — short, opaque, and unlinkable to internal IDs.

### What the public view exposes

The public view is **read-only metadata only**:

- Collection name and description
- Book title, author, cover image, page count, and file type
- No download links, no file access, no reading progress, no user info
- The owner's identity is not exposed (no email, display name, or user ID)

### What the public view does NOT expose

- Book file downloads (`/api/books/[id]/file`)
- The EPUB/PDF reader (`/read/[bookId]`)
- Any editing, adding, or removing books
- Any user-specific data (reading progress, other collections)

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
- Return the collection metadata and paginated book list (same shape as the existing `GET /api/collections/[id]` response, minus any user-specific data).
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

### 5. Middleware: allow public routes

**File:** `src/middleware.ts`

Add exceptions for the public share routes so they bypass authentication:

```ts
// Public shared collection pages and API
if (nextUrl.pathname.startsWith("/shared/") || nextUrl.pathname.startsWith("/api/shared/")) {
  return NextResponse.next();
}
```

Place this check early in the middleware, alongside the existing `/login` and `/setup` exemptions.

### 6. Frontend: share toggle UI in collection detail

**File:** `src/app/(dashboard)/collections/[id]/collection-detail-client.tsx`

Add a "Share" button to the collection detail header (next to the existing Edit and Delete buttons):

- If the collection is not shared: show a "Share" button that calls `POST /api/collections/[id]/share`.
- If the collection is shared: show the share URL in a copyable input field, with a "Copy Link" button and a "Stop Sharing" button that calls `DELETE /api/collections/[id]/share`.
- Use a `Dialog` (consistent with the existing edit dialog pattern) to present sharing options.

Changes to existing data flow:
- The `GET /api/collections/[id]` response should include `shareToken` and `sharedAt` so the UI knows the current share state. Add these two fields to the collection select in the existing route handler.

### 7. Frontend: public collection view page

**File:** `src/app/shared/[token]/page.tsx` (new)

This is a **server component** page outside the `(dashboard)` layout group, so it renders without the authenticated sidebar/nav.

- Fetch collection data from `/api/shared/[token]` server-side.
- Display collection name, description, and a responsive grid of book cards.
- Book cards show cover image (via `/api/shared/<token>/covers/<bookId>`), title, author, file type badge, and page count.
- No links to the reader or download — covers and metadata only.
- Include pagination ("Load More" button) matching the existing collection detail pattern.
- Minimal branding: show "Alex" or the app name and a note like "Shared collection" in the header.
- If the token is invalid, show a 404 page.

**File:** `src/app/shared/[token]/layout.tsx` (new)

A minimal layout without the dashboard sidebar. Basic centered container with a max-width.

**File:** `src/app/shared/[token]/shared-collection-client.tsx` (new)

Client component for pagination and interactivity (same pattern as `collection-detail-client.tsx`, but read-only — no edit/delete/remove actions).

### 8. Component: read-only book card variant

The existing `BookCard` component links to the reader and includes collection-management actions. For the public view, create a variant or pass props to disable interactive features:

**File:** `src/components/library/BookCard.tsx`

- Add an optional `readOnly` prop (default `false`).
- When `readOnly` is true: no click-through link to the reader, no context menu/action buttons, and use the provided `coverUrl` prop instead of the default `/api/books/[id]/cover` path (since the public cover endpoint has a different URL).

Alternatively, if modifying `BookCard` would be too invasive, create a simpler `SharedBookCard` component in `src/components/library/SharedBookCard.tsx` that only renders metadata. This is the safer option since the existing `BookCard` has complex collection-management logic baked in.

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/lib/db/schema.ts` | Modify | Add `shareToken` and `sharedAt` columns to `collections` |
| `src/lib/db/migrations/` | Generate | New migration for the schema change |
| `src/middleware.ts` | Modify | Allow `/shared/*` and `/api/shared/*` without auth |
| `src/app/api/collections/[id]/route.ts` | Modify | Include `shareToken`/`sharedAt` in GET response |
| `src/app/api/collections/[id]/share/route.ts` | Create | POST/DELETE/GET for share toggle |
| `src/app/api/shared/[token]/route.ts` | Create | Public collection data endpoint |
| `src/app/api/shared/[token]/covers/[bookId]/route.ts` | Create | Public cover image endpoint |
| `src/app/(dashboard)/collections/[id]/collection-detail-client.tsx` | Modify | Add share button and share dialog |
| `src/app/shared/[token]/page.tsx` | Create | Public collection view page |
| `src/app/shared/[token]/layout.tsx` | Create | Minimal layout for public view |
| `src/app/shared/[token]/shared-collection-client.tsx` | Create | Client component for public view |
| `src/components/library/SharedBookCard.tsx` | Create | Read-only book card for public view |

---

## Security Considerations

1. **Token unguessability:** UUIDv4 tokens have 122 bits of randomness — sufficient for share links.
2. **No file access:** Public endpoints only serve metadata and cover images. Book files are never exposed without authentication.
3. **Ownership verification:** Only the collection owner can enable/disable sharing.
4. **No user data leakage:** The public response omits the owner's userId, email, and display name.
5. **Cover scoping:** The public cover endpoint verifies the requested book is in the shared collection before serving the image. An attacker cannot use a valid share token to access covers for books not in that collection.
6. **Rate limiting:** Not in scope for this plan, but could be added later to the public endpoints if abuse becomes a concern.

---

## Out of Scope

- Allowing public viewers to read/download book files
- Password-protected shared collections
- Expiring share links
- Per-book sharing (only whole collections)
- Public collection discovery/listing
- Analytics on shared collection views
- Rate limiting on public endpoints

These could be built as follow-up features if needed.
