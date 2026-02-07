# PRD: Public Collections - Share Management API

## Introduction

Create authenticated API endpoints that allow collection owners to enable, disable, and check the sharing status of their collections. This provides the backend foundation for the share toggle UI.

## Goals

- Allow collection owners to enable sharing with a single API call
- Allow collection owners to disable sharing (revoke public access)
- Provide share status information for UI rendering
- Generate unguessable share URLs automatically
- Enforce ownership verification for all share operations

## User Stories

### US-001: Enable sharing on a collection
**Description:** As a collection owner, I want to call an API endpoint to enable sharing so I can generate a public share link.

**Acceptance Criteria:**
- [ ] Create `src/app/api/collections/[id]/share/route.ts`
- [ ] Implement `POST /api/collections/[id]/share` handler
- [ ] Verify user is authenticated (session check)
- [ ] Verify user owns the collection (`collections.userId === session.user.id`)
- [ ] Generate UUIDv4 token using `crypto.randomUUID()`
- [ ] Store token in `shareToken` column
- [ ] Set `sharedAt` to current Unix timestamp
- [ ] Return JSON: `{ shareToken: string, shareUrl: string }`
- [ ] Share URL format: `${process.env.NEXTAUTH_URL}/shared/${shareToken}`
- [ ] Return 401 if not authenticated
- [ ] Return 404 if collection not found
- [ ] Return 403 if user doesn't own the collection
- [ ] Typecheck passes

### US-002: Disable sharing on a collection
**Description:** As a collection owner, I want to call an API endpoint to disable sharing so I can revoke public access to my collection.

**Acceptance Criteria:**
- [ ] Implement `DELETE /api/collections/[id]/share` handler in same route file
- [ ] Verify user is authenticated
- [ ] Verify user owns the collection
- [ ] Set `shareToken = null` in database
- [ ] Set `sharedAt = null` in database
- [ ] Return JSON: `{ success: true }`
- [ ] Return 401 if not authenticated
- [ ] Return 404 if collection not found
- [ ] Return 403 if user doesn't own the collection
- [ ] Typecheck passes

### US-003: Check sharing status
**Description:** As a collection owner, I want to check if my collection is currently shared so the UI can display the current state.

**Acceptance Criteria:**
- [ ] Implement `GET /api/collections/[id]/share` handler in same route file
- [ ] Verify user is authenticated
- [ ] Verify user owns the collection
- [ ] Return JSON: `{ isShared: boolean, shareToken: string | null, sharedAt: number | null }`
- [ ] `isShared` is `true` when `shareToken` is not null
- [ ] Return 401 if not authenticated
- [ ] Return 404 if collection not found
- [ ] Return 403 if user doesn't own the collection
- [ ] Typecheck passes

### US-004: Update collection detail endpoint to include share data
**Description:** As a developer, I need the existing collection detail endpoint to include share status so the UI can render share controls without an extra API call.

**Acceptance Criteria:**
- [ ] Modify `src/app/api/collections/[id]/route.ts` GET handler
- [ ] Add `shareToken` and `sharedAt` to the database select query
- [ ] Include both fields in the JSON response
- [ ] Existing functionality unchanged (backward compatible)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: POST `/api/collections/[id]/share` must generate a UUIDv4 token and enable sharing
- FR-2: DELETE `/api/collections/[id]/share` must set `shareToken` to null and disable sharing
- FR-3: GET `/api/collections/[id]/share` must return current sharing status
- FR-4: All endpoints must verify authentication using existing session pattern
- FR-5: All endpoints must verify ownership before allowing modifications
- FR-6: Share URLs must use the format `/shared/{token}` (no collection ID exposed)
- FR-7: Timestamps must use Unix seconds (not milliseconds) for consistency
- FR-8: GET `/api/collections/[id]` must include `shareToken` and `sharedAt` in response

## Non-Goals (Out of Scope)

- No custom share URLs or vanity paths
- No share token regeneration (deleting and re-creating achieves the same effect)
- No expiring links or password protection
- No share analytics (view counts, access logs)
- No email/social media sharing helpers (just return the URL)

## Design Considerations

### URL Format
The share URL uses `/shared/{token}` rather than `/collections/{id}/shared` to:
- Hide the internal collection ID (prevents enumeration)
- Make the URL shorter and cleaner
- Allow token revocation without changing the collection ID

### Token Generation
Use `crypto.randomUUID()` because:
- Built-in to Node.js (no dependencies)
- UUIDv4 provides 122 bits of randomness
- String format is URL-safe

### Timestamp Format
Use Unix seconds (not milliseconds) to:
- Match common database timestamp conventions
- Reduce storage size
- Align with other timestamp fields in the app

## Technical Considerations

- Use existing session validation pattern from other authenticated routes
- Database updates should be atomic (single UPDATE query)
- Environment variable `NEXTAUTH_URL` must be set for share URL generation
- Return appropriate HTTP status codes (401, 403, 404, 200)
- Use Drizzle ORM's `.update()` method for modifications
- Share token should be selected in ownership verification query (avoid extra round-trip)

## Success Metrics

- Share links work reliably and securely (primary success criterion)
- All three endpoints (POST, DELETE, GET) return correct responses
- Ownership verification prevents unauthorized access
- Tokens are unguessable (UUIDv4 randomness)
- No unauthorized users can enable/disable sharing
- Typecheck and lint pass with no errors

## Open Questions

- Should enabling sharing on an already-shared collection regenerate the token? (No - return existing token)
- Should we log share enable/disable actions for audit trail? (Not in MVP)
