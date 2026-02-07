# PRD: Public Collections - Database Schema & Shared Helpers

## Introduction

Establish the database foundation for public collection sharing by adding share token columns and creating reusable helper functions for token validation. This enables collections to be shared via unguessable URLs while maintaining security through token-based access control.

## Goals

- Add share token storage to collections table
- Support toggling between private and shared states
- Create reusable validation helpers for public endpoints
- Ensure tokens are unguessable (UUIDv4 with 122 bits of randomness)
- Track when collections were first shared

## User Stories

### US-001: Add share token columns to database schema
**Description:** As a developer, I need to store share tokens and sharing timestamps in the collections table so the system can manage public/private state.

**Acceptance Criteria:**
- [ ] Add `shareToken` column to `collections` table (text, unique, nullable)
- [ ] Add `sharedAt` column to `collections` table (integer timestamp, nullable)
- [ ] Both columns default to `null` (collection is private by default)
- [ ] Schema file updated: `src/lib/db/schema.ts`
- [ ] Typecheck passes

### US-002: Generate and run database migration
**Description:** As a developer, I need to apply the schema changes to the database so existing collections can support sharing.

**Acceptance Criteria:**
- [ ] Run `pnpm drizzle-kit generate` to create migration file
- [ ] Migration file appears in `src/lib/db/migrations/`
- [ ] Run migration successfully against development database
- [ ] Verify columns exist using database inspection tool
- [ ] No data loss (nullable columns safe for existing records)

### US-003: Create shared collection validation helper
**Description:** As a developer, I need a reusable function to look up collections by share token so all public endpoints can validate tokens consistently.

**Acceptance Criteria:**
- [ ] Create `src/lib/shared.ts` file
- [ ] Implement `getSharedCollection(token: string)` function
- [ ] Function queries `collections` table where `shareToken = token`
- [ ] Returns collection row if found and shared, `null` otherwise
- [ ] Function handles invalid/missing tokens gracefully
- [ ] Typecheck passes

### US-004: Create shared book validation helper
**Description:** As a developer, I need a reusable function to verify a book belongs to a shared collection so public endpoints cannot access books outside the shared scope.

**Acceptance Criteria:**
- [ ] Implement `getSharedBook(token: string, bookId: string)` function in `src/lib/shared.ts`
- [ ] Function first validates the share token via `getSharedCollection`
- [ ] Then verifies the book exists in the collection's books
- [ ] Returns book row if both checks pass, `null` otherwise
- [ ] Prevents access to books not in the shared collection
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The `collections` table must include a `shareToken` column (text, unique, nullable)
- FR-2: The `collections` table must include a `sharedAt` column (integer, nullable)
- FR-3: When `shareToken` is `null`, the collection must be private
- FR-4: When `shareToken` is a valid UUID, the collection must be publicly accessible
- FR-5: The `getSharedCollection(token)` helper must return the collection if the token matches and is not null
- FR-6: The `getSharedBook(token, bookId)` helper must validate both token and book membership
- FR-7: All database queries must use proper indexes (unique constraint on `shareToken`)

## Non-Goals (Out of Scope)

- No UI changes in this PRD (covered in later PRDs)
- No API endpoints (covered in later PRDs)
- No password protection or expiring links
- No token regeneration logic (added when share toggle is implemented)

## Design Considerations

### Token Format
- Use `crypto.randomUUID()` for UUIDv4 generation
- 122 bits of randomness prevents enumeration attacks
- Unique constraint prevents collisions
- Nullable allows clear private/public distinction

### Migration Safety
- Nullable columns prevent migration failures on existing data
- No default value needed (null = private is semantic)
- Unique constraint on nullable column is safe (NULLs don't conflict)

## Technical Considerations

- Drizzle ORM schema definition pattern: `text("share_token").unique()`
- Migration is additive (no data modification required)
- Helper functions should use async/await for database queries
- Error handling: distinguish between "token not found" and "database error"
- The helpers will be imported by multiple API routes, so keep them pure/side-effect-free

## Success Metrics

- Migration runs successfully without errors
- All existing collections remain accessible (no data loss)
- Helper functions return correct results for valid/invalid tokens
- Typecheck and lint pass with no errors
- Database queries execute efficiently (unique index used)

## Open Questions

- Should we add an index on `sharedAt` for future analytics? (Not needed for MVP)
- Should tokens be regeneratable or permanent per collection? (Handle in share toggle PRD)
