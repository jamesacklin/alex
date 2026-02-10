# PRD: OPDS Middleware Exemption

## Introduction/Overview
Ensure OPDS routes bypass NextAuth middleware so OPDS clients can authenticate using Basic Auth or API keys without session cookies.

## Goals
- Allow `/opds/` routes to pass through middleware untouched.
- Keep all non-OPDS routes and auth flows unchanged.

## User Stories

### US-001: Bypass NextAuth for OPDS routes
**Description:** As a developer, I want `/opds/` paths to skip NextAuth checks so OPDS auth can be handled by the OPDS routes.

**Acceptance Criteria:**
- [ ] `src/middleware.ts` returns `NextResponse.next()` early for paths starting with `/opds/`.
- [ ] No other middleware behavior changes.
- [ ] Typecheck/lint passes.

## Functional Requirements
1. Add an early `/opds/` path check in middleware.
2. Keep all existing middleware logic intact for other routes.

## Non-Goals
- Any changes to session handling or protected routes outside `/opds/`.
- New authentication methods for non-OPDS endpoints.

## Design Considerations
- Keep the change minimal and localized.

## Technical Considerations
- Ensure the check includes `/opds/shared/...` routes.

## Success Metrics
- OPDS endpoints no longer redirect to login or return NextAuth errors.

## Open Questions
- None.
