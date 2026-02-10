# PRD: OPDS API Key Storage

## Introduction/Overview
Add an optional OPDS API key field to the users table so OPDS clients can authenticate via a URL-based key when Basic Auth is unreliable. This is a schema-only, additive change.

## Goals
- Add a nullable, unique OPDS API key column to users.
- Keep all existing authentication flows unchanged.
- Provide a schema foundation for later key generation and UI display.

## User Stories

### US-001: Add OPDS API key column
**Description:** As a developer, I want a nullable `opds_api_key` column on `users` so we can store per-user OPDS API keys.

**Acceptance Criteria:**
- [ ] Update `src/lib/db/schema.ts` to include `opdsApiKey` as a nullable unique text column.
- [ ] Generate a migration that adds the column without backfilling data.
- [ ] Existing users remain valid with `opds_api_key` set to NULL.
- [ ] Typecheck/lint passes.

### US-002: Surface OPDS API key in ORM types
**Description:** As a developer, I want the ORM types to include `opdsApiKey` so OPDS features can read/write it.

**Acceptance Criteria:**
- [ ] The generated types expose `opdsApiKey` on the user model.
- [ ] No runtime behavior changes occur outside OPDS features.
- [ ] Typecheck/lint passes.

## Functional Requirements
1. Add `opds_api_key` to `users` as nullable and unique.
2. The migration must be additive and non-destructive.
3. No existing login, session, or authorization logic is modified.

## Non-Goals
- No API key generation or regeneration logic.
- No OPDS authentication behavior changes.
- No UI changes.

## Design Considerations
- None.

## Technical Considerations
- Use Drizzle schema and migration tooling.
- Keep the column nullable to avoid generating keys for unused accounts.

## Success Metrics
- Migration applies cleanly in dev and CI.
- New code can read/write `opdsApiKey` without affecting existing users.

## Open Questions
- Should we add a separate index beyond the unique constraint, or rely on the unique index alone?
