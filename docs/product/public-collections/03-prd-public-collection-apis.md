# PRD: Public Collections - Public Collection APIs

## Introduction

Create unauthenticated API endpoints that serve collection data, book covers, and book files to anonymous public viewers. These endpoints validate share tokens and enforce book membership to prevent unauthorized access.

## Goals

- Serve collection metadata and book lists to anonymous users via share token
- Serve book cover images for books in shared collections
- Stream PDF files to the public reader with range request support
- Serve EPUB files to the public reader
- Prevent access to books outside the shared collection
- Maintain security through token validation and book scoping

## User Stories

### US-001: Fetch public collection data
**Description:** As an anonymous user with a share link, I want to fetch the collection's metadata and book list so I can browse the shared collection.

**Acceptance Criteria:**
- [ ] Create `src/app/api/shared/[token]/route.ts`
- [ ] Implement `GET /api/shared/[token]` handler
- [ ] No authentication required (anonymous access)
- [ ] Use `getSharedCollection(token)` helper to validate token
- [ ] Return 404 if token is invalid or collection not shared
- [ ] Support `?page` and `?limit` query params for pagination
- [ ] Default to `page=1` and `limit=24` (matching main library)
- [ ] Return JSON matching the lazy-load pagination shape:
  ```json
  {
    "collection": { "name": "...", "description": "..." },
    "books": [ /* book objects */ ],
    "total": 42,
    "page": 1,
    "totalPages": 2,
    "hasMore": true
  }
  ```
- [ ] Book objects include: `id`, `title`, `author`, `fileType`, `pageCount`, `coverUrl`
- [ ] `coverUrl` points to public cover endpoint: `/api/shared/{token}/covers/{bookId}`
- [ ] Owner identity not exposed (no `userId`, `email`, or `displayName`)
- [ ] Typecheck passes

### US-002: Serve public cover images
**Description:** As an anonymous user viewing a shared collection, I want to see book cover images so I can identify books visually.

**Acceptance Criteria:**
- [ ] Create `src/app/api/shared/[token]/covers/[bookId]/route.ts`
- [ ] Implement `GET /api/shared/[token]/covers/[bookId]` handler
- [ ] No authentication required
- [ ] Use `getSharedBook(token, bookId)` helper to validate access
- [ ] Return 404 if token invalid or book not in collection
- [ ] Serve cover image from storage with correct `Content-Type`
- [ ] Support same cover logic as `/api/books/[id]/cover` (including SVG placeholder)
- [ ] Set appropriate cache headers (covers don't change frequently)
- [ ] Typecheck passes

### US-003: Stream PDF files for public reader
**Description:** As an anonymous user reading a shared PDF, I want the file streamed to my browser so I can read it in the PDF reader without downloading.

**Acceptance Criteria:**
- [ ] Create `src/app/api/shared/[token]/books/[bookId]/file/route.ts`
- [ ] Implement `GET /api/shared/[token]/books/[bookId]/file` handler
- [ ] No authentication required
- [ ] Use `getSharedBook(token, bookId)` helper to validate access
- [ ] Return 404 if token invalid or book not in collection
- [ ] Stream file from storage with `Content-Type: application/pdf`
- [ ] Support HTTP `Range` header for PDF.js streaming (required for large files)
- [ ] Return `206 Partial Content` for range requests
- [ ] Return `200 OK` for full file requests
- [ ] Set `Accept-Ranges: bytes` header
- [ ] Reuse range request logic from `/api/books/[id]/file`
- [ ] Typecheck passes

### US-004: Serve EPUB files for public reader
**Description:** As an anonymous user reading a shared EPUB, I want the file served with the `.epub` extension so the EPUB reader library can load it correctly.

**Acceptance Criteria:**
- [ ] Create `src/app/api/shared/[token]/books/[bookId]/book.epub/route.ts`
- [ ] Implement `GET /api/shared/[token]/books/[bookId]/book.epub` handler
- [ ] No authentication required
- [ ] Use `getSharedBook(token, bookId)` helper to validate access
- [ ] Return 404 if token invalid or book not in collection
- [ ] Serve file with `Content-Type: application/epub+zip`
- [ ] Return file as ArrayBuffer (required by react-reader/epubjs)
- [ ] Route must end in `.epub` (epubjs requirement)
- [ ] Reuse EPUB serving logic from `/api/books/[id]/book.epub`
- [ ] Typecheck passes

## Functional Requirements

- FR-1: GET `/api/shared/[token]` must return collection data and paginated book list
- FR-2: GET `/api/shared/[token]/covers/[bookId]` must serve cover images for books in the collection
- FR-3: GET `/api/shared/[token]/books/[bookId]/file` must stream PDF files with range request support
- FR-4: GET `/api/shared/[token]/books/[bookId]/book.epub` must serve EPUB files
- FR-5: All endpoints must validate the share token using `getSharedCollection` helper
- FR-6: All book-specific endpoints must validate book membership using `getSharedBook` helper
- FR-7: Invalid tokens must return 404 (not 401 - no authentication expected)
- FR-8: Books outside the shared collection must not be accessible even with a valid token
- FR-9: Pagination must match the lazy-load pattern (hasMore, totalPages fields)
- FR-10: Response must not expose owner identity (userId, email, displayName omitted)

## Non-Goals (Out of Scope)

- No direct download links or download buttons
- No authentication/login prompts for anonymous users
- No server-side reading progress for anonymous users
- No rate limiting (can be added later if needed)
- No analytics on public access (view counts, visitor tracking)
- No watermarking or DRM on public files

## Design Considerations

### Security Through Book Scoping
Every book-specific endpoint validates:
1. Share token is valid (collection exists and is shared)
2. Book ID belongs to that specific collection

This prevents a valid share token from being used to access books in other collections.

### Cover URL Pattern
Cover URLs use the format `/api/shared/{token}/covers/{bookId}` so:
- Book cards can display covers without authentication
- Token scoping is enforced for cover access
- No direct file paths or internal IDs exposed

### Range Request Support
PDF streaming requires range requests because:
- PDF.js loads pages on demand (not entire file upfront)
- Large PDFs would be slow/impossible to load fully
- Range requests enable efficient page navigation

### EPUB File Extension Requirement
The route must end in `.epub` because:
- epubjs library requires URLs ending in `.epub` for MIME detection
- This is a known limitation of the library
- Alternative is to use blob URLs, which adds complexity

## Technical Considerations

- Reuse existing file streaming logic from authenticated endpoints
- File paths constructed from database `filePath` column
- Use Node.js `fs.createReadStream` for efficient streaming
- Range header parsing: `Range: bytes=0-1023` → read bytes 0-1023
- Calculate `Content-Length` and `Content-Range` headers correctly
- EPUB files served as full ArrayBuffer (not streamed)
- Use the `getSharedCollection` and `getSharedBook` helpers consistently
- Return 404 for both "token not found" and "book not in collection" (don't leak info)

## Success Metrics

- Share links work reliably and securely (primary success criterion)
- Anonymous users can view collections without authentication
- PDF reader loads pages instantly via range requests
- EPUB reader opens books without errors
- No books outside shared collections are accessible
- Cover images load correctly in public book cards
- Pagination works correctly (hasMore, page navigation)
- Typecheck and lint pass with no errors

## Open Questions

- Should we add cache headers for collection data? (Yes - collections change infrequently)
- Should we serve covers in multiple sizes? (Not in MVP - use existing cover logic)
- Should we compress EPUB files during transfer? (Not needed - already zipped)
