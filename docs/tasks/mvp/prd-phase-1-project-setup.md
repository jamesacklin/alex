# PRD: Phase 1 - Project Setup

## Introduction

Initialize the foundational infrastructure for the book library application: Next.js 15 framework, shadcn/ui component library, Drizzle ORM with SQLite, and the complete database schema. This phase establishes the development environment with no user-facing pages.

## Goals

- Establish type-safe development environment with strict TypeScript
- Configure shadcn/ui component library with core components
- Create complete database schema for all application entities
- Set up seed script for test admin user
- Configure environment variables and project structure

## User Stories

### US-1.1: Initialize Next.js Project
**Description:** As a developer, I need a Next.js 15 project with TypeScript so I can build the application.

**Acceptance Criteria:**
- [ ] Project created with `pnpm create next-app@latest` using App Router
- [ ] TypeScript strict mode enabled in `tsconfig.json`
- [ ] `src/` directory structure in place
- [ ] `pnpm dev` starts server on localhost:3000
- [ ] `pnpm build` succeeds without errors

### US-1.2: Configure shadcn/ui
**Description:** As a developer, I need shadcn/ui set up so I have accessible, customizable components.

**Acceptance Criteria:**
- [ ] Run `pnpm dlx shadcn@latest init` with New York style, Zinc color
- [ ] `components.json` created with correct paths
- [ ] `src/lib/utils.ts` contains `cn()` function
- [ ] CSS variables for theming in `globals.css`
- [ ] Install components: Button, Card, Input, Label, Dialog, Table, DropdownMenu, Avatar, Badge, Skeleton, Form, Sonner

### US-1.3: Set Up Drizzle ORM
**Description:** As a developer, I need database tooling configured so I can define and migrate schemas.

**Acceptance Criteria:**
- [ ] `drizzle-orm` and `better-sqlite3` installed
- [ ] `drizzle-kit` installed as dev dependency
- [ ] `drizzle.config.ts` configured for SQLite
- [ ] `src/lib/db/index.ts` exports database connection
- [ ] Connection uses `DATABASE_PATH` env variable

### US-1.4: Create Database Schema
**Description:** As a developer, I need the complete schema defined so all tables are ready for use.

**Acceptance Criteria:**
- [ ] `src/lib/db/schema.ts` defines all tables:
  - `users` (id, email, passwordHash, displayName, role, createdAt, updatedAt)
  - `books` (id, title, author, description, fileType, filePath, fileSize, fileHash, coverPath, pageCount, addedAt, updatedAt)
  - `readingProgress` (id, userId, bookId, currentPage, totalPages, epubLocation, percentComplete, status, lastReadAt)
  - `collections` (id, userId, name, description, createdAt)
  - `collectionBooks` (collectionId, bookId, addedAt)
  - `settings` (key, value, updatedAt)
- [ ] Foreign key relationships defined
- [ ] `pnpm db:push` applies schema to `data/library.db`

### US-1.5: Create Seed Script
**Description:** As a developer, I need a seed script to create a test admin user for development.

**Acceptance Criteria:**
- [ ] `src/lib/db/seed.ts` creates admin user
- [ ] Admin: email `admin@localhost`, password `admin123` (bcrypt hashed)
- [ ] `pnpm db:seed` script in package.json
- [ ] Script is idempotent (doesn't fail if user exists)

### US-1.6: Environment Configuration
**Description:** As a developer, I need environment variables configured for local development.

**Acceptance Criteria:**
- [ ] `.env.local` with: `DATABASE_PATH`, `LIBRARY_PATH`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- [ ] `.env.example` template committed (no secrets)
- [ ] `data/` directory in `.gitignore`

## Functional Requirements

- FR-1.1: Next.js 15 with App Router and `src/` directory
- FR-1.2: TypeScript strict mode enabled
- FR-1.3: shadcn/ui initialized with specified components
- FR-1.4: Drizzle ORM configured for SQLite with `better-sqlite3`
- FR-1.5: Complete schema with all 6 tables and relationships
- FR-1.6: Seed script creates test admin user
- FR-1.7: Database stored at `data/library.db`

## Non-Goals

- No UI pages or layouts
- No API routes
- No authentication logic (just schema)
- No file watcher

## Technical Considerations

- Use `better-sqlite3` (synchronous) not `@libsql/client`
- Schema uses text IDs (UUIDs via `crypto.randomUUID()`)
- Timestamps stored as integers (Unix epoch)
- Use `bcryptjs` (pure JS) for password hashing in seed

## Success Metrics

- `pnpm dev` starts without errors
- `pnpm build` completes successfully
- `pnpm db:push` creates database with all tables
- `pnpm db:seed` creates admin user

## Open Questions

- None - requirements are fully specified
