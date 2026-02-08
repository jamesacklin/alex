# PRD: Public Collections - Middleware Updates

## Introduction

Update the authentication middleware to allow anonymous access to public collection pages and API endpoints while maintaining authentication requirements for all other routes.

## Goals

- Allow `/shared/*` pages to render without authentication
- Allow `/api/shared/*` endpoints to accept unauthenticated requests
- Maintain existing authentication requirements for all other routes
- Preserve security for authenticated routes

## User Stories

### US-001: Bypass authentication for public collection pages
**Description:** As an anonymous user with a share link, I want to access the public collection page without being redirected to login so I can view the shared collection immediately.

**Acceptance Criteria:**
- [ ] Modify `src/middleware.ts`
- [ ] Add route exception for `/shared/*` paths
- [ ] Requests to `/shared/{token}` do not require authentication
- [ ] Requests to `/shared/{token}/read/{bookId}` do not require authentication
- [ ] Anonymous users can access these pages without redirect to `/login`
- [ ] Existing authenticated routes still require authentication
- [ ] Typecheck passes

### US-002: Bypass authentication for public API endpoints
**Description:** As a public collection page, I want to call the public API endpoints without authentication so anonymous users can fetch collection data and book files.

**Acceptance Criteria:**
- [ ] Add route exception for `/api/shared/*` paths in `src/middleware.ts`
- [ ] Requests to all `/api/shared/{token}/*` endpoints do not require authentication
- [ ] Includes collection data, covers, and book file endpoints
- [ ] Existing authenticated API routes still require authentication
- [ ] Typecheck passes

### US-003: Verify authentication still enforced elsewhere
**Description:** As a developer, I want to confirm that authentication is still required for all non-public routes so security is not weakened.

**Acceptance Criteria:**
- [ ] Test accessing `/library` without auth → redirects to `/login`
- [ ] Test accessing `/collections` without auth → redirects to `/login`
- [ ] Test accessing `/api/books/*` without auth → returns 401
- [ ] Test accessing `/api/collections/*` without auth → returns 401
- [ ] Only `/shared/*` and `/api/shared/*` allow anonymous access
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Middleware must allow `/shared/*` paths without authentication
- FR-2: Middleware must allow `/api/shared/*` paths without authentication
- FR-3: Middleware must continue requiring authentication for all other paths
- FR-4: Public route exceptions must be checked early in middleware (before auth redirect logic)
- FR-5: Middleware logic must be clear and maintainable (comment explaining public routes)

## Non-Goals (Out of Scope)

- No changes to session handling or authentication logic
- No new authentication methods or providers
- No rate limiting (can be added in future if needed)
- No logging of anonymous access (not in MVP)

## Design Considerations

### Placement in Middleware
The public route exceptions should be placed:
- Early in the middleware function (before auth checks)
- Alongside existing exemptions for `/login`, `/setup`, etc.
- With a clear comment explaining why these routes are public

Example placement:
```typescript
// Public shared collection pages and API
if (nextUrl.pathname.startsWith("/shared/") || nextUrl.pathname.startsWith("/api/shared/")) {
  return NextResponse.next();
}
```

### Security Implications
Allowing anonymous access to `/shared/*` and `/api/shared/*` is safe because:
- Token validation happens within each endpoint
- Book scoping prevents unauthorized access
- No user data or write operations exposed
- Existing authenticated routes remain protected

## Technical Considerations

- Middleware runs on every request (keep exemption check efficient)
- Use `nextUrl.pathname.startsWith()` for path matching (consistent with existing pattern)
- Place exemptions before the authentication redirect logic
- Use `NextResponse.next()` to proceed without auth check
- Maintain existing middleware structure (minimal changes)
- Comment the exemptions clearly for future maintainers

## Success Metrics

- Anonymous users can access `/shared/{token}` without redirect
- Anonymous users can access `/shared/{token}/read/{bookId}` without redirect
- Public API endpoints return data without requiring authentication
- Authenticated routes still enforce login requirement
- No regression in existing authentication behavior
- Typecheck and lint pass with no errors

## Open Questions

- Should we add logging for public route access? (Not in MVP - can add later)
- Should we differentiate between 404 (not found) and 401 (not authenticated) for public routes? (No - always return 404 for invalid tokens to avoid information leakage)
