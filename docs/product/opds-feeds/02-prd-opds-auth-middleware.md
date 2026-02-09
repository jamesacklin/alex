# PRD: OPDS Authentication Middleware

## Introduction/Overview
Implement a shared authentication helper for OPDS endpoints that supports HTTP Basic Auth and a per-user API key embedded in the URL path. This is additive and independent of NextAuth sessions.

## Goals
- Authenticate OPDS requests via API key or Basic Auth.
- Keep OPDS auth isolated from session-based web auth.
- Provide a consistent contract for OPDS route handlers.

## User Stories

### US-001: Authenticate via API key param
**Description:** As a developer, I want OPDS routes to accept an `apiKey` path param so clients without Basic Auth support can authenticate.

**Acceptance Criteria:**
- [ ] `authenticateOpdsRequest(request, { apiKey })` looks up a user by `opdsApiKey`.
- [ ] Missing or invalid keys return `null`.
- [ ] Typecheck/lint passes.

### US-002: Authenticate via HTTP Basic Auth
**Description:** As a developer, I want OPDS routes to validate `Authorization: Basic` credentials against the users table.

**Acceptance Criteria:**
- [ ] Basic credentials are parsed into `email` and `password`.
- [ ] Password validation uses bcrypt against the stored hash.
- [ ] Invalid or missing credentials return `null`.
- [ ] Typecheck/lint passes.

### US-003: Consistent unauthorized behavior contract
**Description:** As a developer, I want a clear contract that `null` means the caller should return `401 Unauthorized` with `WWW-Authenticate: Basic realm="Alex"`.

**Acceptance Criteria:**
- [ ] The helper returns `User | null` only.
- [ ] Callers can unambiguously detect unauthorized requests.
- [ ] Typecheck/lint passes.

## Functional Requirements
1. Provide `authenticateOpdsRequest(request, params?)` in `src/lib/opds/auth.ts`.
2. If `params.apiKey` is provided, attempt API key auth first.
3. If API key auth fails, attempt Basic Auth from the `Authorization` header.
4. On any failure, return `null` without throwing or logging credentials.
5. Do not create sessions, cookies, or JWTs.

## Non-Goals
- OAuth, Digest auth, or token refresh flows.
- Credential caching or rate limiting.
- Changes to existing NextAuth or API auth logic.

## Design Considerations
- Keep the function stateless and safe to call per request.

## Technical Considerations
- Handle malformed Base64 or missing `:` gracefully.
- Avoid leaking credentials in logs or error messages.

## Success Metrics
- A valid API key or Basic Auth pair yields an authenticated user in manual testing.
- Invalid credentials consistently yield `401` responses from OPDS routes.

## Open Questions
- Do we want a short-lived in-memory cache for bcrypt checks, or defer until performance is a concern?
