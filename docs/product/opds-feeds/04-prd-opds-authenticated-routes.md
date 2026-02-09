# PRD: Authenticated OPDS Routes (v1.2)

## Introduction/Overview
Add authenticated OPDS 1.2 endpoints that expose the full library and collections as Atom feeds, plus book download and cover endpoints. This is read-only and additive.

## Goals
- Provide OPDS navigation and acquisition feeds for authenticated users.
- Support both Basic Auth and API key authentication.
- Reuse existing data access and file-serving logic without changing core behavior.

## User Stories

### US-001: Catalog root navigation feed
**Description:** As a user, I want a root OPDS catalog feed so my client can discover library sections.

**Acceptance Criteria:**
- [ ] `GET /opds/v1.2/catalog` returns a navigation feed with links to All Books, Recently Added, and Collections.
- [ ] The feed includes `self`, `start`, and `search` links.
- [ ] The response uses the navigation content type.
- [ ] Typecheck/lint passes.

### US-002: All books acquisition feed
**Description:** As a user, I want a paginated acquisition feed of all books so I can browse large libraries.

**Acceptance Criteria:**
- [ ] `GET /opds/v1.2/all?page=N` returns books ordered by title.
- [ ] Page size defaults to 50 with `next` or `previous` links when applicable.
- [ ] Facet links include sort (title, author, recently added) and format filters (PDF, EPUB).
- [ ] Typecheck/lint passes.

### US-003: Recently added feed
**Description:** As a user, I want a feed of recently added books so I can quickly find new items.

**Acceptance Criteria:**
- [ ] `GET /opds/v1.2/new` returns the latest 50 books ordered by `addedAt` desc.
- [ ] The response uses the acquisition content type.
- [ ] Typecheck/lint passes.

### US-004: Collections navigation and collection feeds
**Description:** As a user, I want to browse my collections and their books in OPDS.

**Acceptance Criteria:**
- [ ] `GET /opds/v1.2/collections` returns a navigation feed of my collections.
- [ ] `GET /opds/v1.2/collections/{id}` returns a paginated acquisition feed for that collection.
- [ ] Collection access is validated against the authenticated user.
- [ ] Typecheck/lint passes.

### US-005: Search endpoints
**Description:** As a user, I want OPDS search so I can find books by title or author.

**Acceptance Criteria:**
- [ ] `GET /opds/v1.2/search` returns an OpenSearch description document.
- [ ] `GET /opds/v1.2/search?q=term` returns acquisition search results using existing search logic.
- [ ] Typecheck/lint passes.

### US-006: OPDS book file and cover endpoints
**Description:** As a user, I want OPDS-specific file and cover URLs so my client can download and display books reliably.

**Acceptance Criteria:**
- [ ] `GET /opds/v1.2/books/{id}/file` authenticates and streams the book file.
- [ ] `GET /opds/v1.2/books/{id}/cover` authenticates and streams the cover image with correct content type.
- [ ] Endpoints reuse existing file or cover logic without altering it.
- [ ] Typecheck/lint passes.

### US-007: API key path variants
**Description:** As a user, I want API-key-prefixed OPDS routes so clients without Basic Auth can access the catalog.

**Acceptance Criteria:**
- [ ] All authenticated OPDS routes work under `/opds/{apiKey}/v1.2/...`.
- [ ] The API key variant uses the same handlers and XML output.
- [ ] Typecheck/lint passes.

## Functional Requirements
1. Implement authenticated routes under `/opds/v1.2/` as described in the plan.
2. Support both Basic Auth and API key authentication via the shared auth helper.
3. Use XML builders for all feed responses.
4. Set correct OPDS content types for navigation and acquisition feeds.
5. Use absolute-path `href` values in all XML links.
6. Reuse existing data queries and file or cover serving logic without modifying core behavior.
7. Keep all OPDS endpoints read-only.

## Non-Goals
- OPDS 2.0 or JSON feeds.
- Any write operations via OPDS.
- Changes to existing `/api/books` or web UI behavior.

## Design Considerations
- Keep route handlers thin and rely on shared builders and helpers.

## Technical Considerations
- Ensure `WWW-Authenticate` header is set for unauthorized requests.
- Consider a shared handler or catch-all to avoid code duplication for API key routes.

## Success Metrics
- OPDS clients can browse and download using both Basic Auth and API key URLs.
- Feeds load without errors in at least one desktop and one mobile OPDS client.

## Open Questions
- Should the All Books feed be restricted to admins if per-user libraries are added later?
