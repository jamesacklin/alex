# PRD: Public OPDS Feeds for Shared Collections

## Introduction/Overview
Expose shared collections as public OPDS acquisition feeds accessible via existing share tokens. No authentication is required beyond the token.

## Goals
- Provide OPDS feeds for shared collections using existing share tokens.
- Reuse current public share logic and file endpoints.
- Keep public OPDS access read-only and scoped.

## User Stories

### US-001: Shared collection acquisition feed
**Description:** As a visitor, I want to open an OPDS feed for a shared collection so I can browse its books.

**Acceptance Criteria:**
- [ ] `GET /opds/shared/{token}` returns an acquisition feed for the collection.
- [ ] Invalid tokens return `404` without leaking information.
- [ ] The feed uses the acquisition content type.
- [ ] Typecheck/lint passes.

### US-002: Shared collection search
**Description:** As a visitor, I want OPDS search within a shared collection.

**Acceptance Criteria:**
- [ ] `GET /opds/shared/{token}/search` returns an OpenSearch description document.
- [ ] `GET /opds/shared/{token}/search?q=term` returns acquisition results scoped to the collection.
- [ ] Typecheck/lint passes.

### US-003: Public file and cover links
**Description:** As a visitor, I want book links to use the existing public endpoints so downloads and covers work reliably.

**Acceptance Criteria:**
- [ ] Acquisition links point to `/api/shared/{token}/books/{bookId}/file`.
- [ ] Cover links point to `/api/shared/{token}/books/{bookId}/cover`.
- [ ] Typecheck/lint passes.

## Functional Requirements
1. Implement `/opds/shared/{token}` and `/opds/shared/{token}/search` routes.
2. Validate tokens using existing shared-collection helpers.
3. Use XML builders and absolute-path links.
4. Keep all public OPDS endpoints read-only and scoped to the token.

## Non-Goals
- Listing all shared collections.
- Any authentication or session handling.
- Changes to existing share token generation or revocation.

## Design Considerations
- Match the public web share behavior and visibility.

## Technical Considerations
- Ensure 404 on invalid or revoked tokens.
- Keep content types consistent with OPDS 1.2.

## Success Metrics
- A valid share token produces an OPDS feed that downloads books successfully.

## Open Questions
- Should public feeds include collection-level metadata beyond the title, such as a description?
