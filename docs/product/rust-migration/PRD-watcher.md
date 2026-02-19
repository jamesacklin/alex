# PRD: Rust File Watcher (watcher-rs)

## Introduction

Replace the TypeScript file watcher (`watcher/`) with a standalone Rust binary (`watcher-rs/`) that monitors a library directory for `.pdf` and `.epub` files, extracts text metadata, and writes to the existing SQLite database. The Rust watcher must be a drop-in replacement compatible with the current database schema and the running Electron/Next.js app. Cover image generation (both PDF and EPUB) is out of scope for this PRD and will be handled separately.

## Goals

- Produce a standalone Rust binary that watches a directory for `.pdf` and `.epub` files
- Extract title, author, description, and page count metadata from both formats
- Write to the existing SQLite schema (`books` table) with the same column semantics as the TypeScript watcher
- Maintain functional equivalence: same books ingested, same deduplication behavior, same orphan cleanup
- Run alongside the existing Electron app during migration (shared SQLite file with WAL mode)
- Accept configuration via CLI arguments or environment variables (CLI takes precedence)
- Match the TypeScript watcher's console output format and level

## User Stories

### US-001: Watch a directory for book files

**Description:** As a developer, I want the Rust watcher to monitor a directory tree for `.pdf` and `.epub` files so that new books are detected automatically.

**Acceptance Criteria:**
- [ ] Recursively watches the configured library path
- [ ] Only reacts to files with `.pdf` or `.epub` extensions (case-insensitive)
- [ ] Ignores all other file types
- [ ] Continues watching after initial scan completes
- [ ] Handles `SIGINT` and `SIGTERM` for graceful shutdown

### US-002: Debounce file write events

**Description:** As a developer, I want the watcher to wait for files to finish writing before processing them, so that partially-written files are not ingested.

**Acceptance Criteria:**
- [ ] After detecting a new or changed file, waits until the file size has been stable for 2 seconds before processing
- [ ] Zero-byte files are skipped with a log message: `[SKIP] Zero-byte file (waiting for write): {path}`
- [ ] A file that grows during the stability window resets the 2-second timer

### US-003: Hash and deduplicate files

**Description:** As a developer, I want files to be SHA-256 hashed and deduplicated so that the same book content is not added twice.

**Acceptance Criteria:**
- [ ] Computes SHA-256 hash of the full file contents
- [ ] Before inserting, queries the `books` table for an existing row with the same `file_hash`
- [ ] If a duplicate hash is found, logs `[SKIP] Duplicate (matches "{title}"): {path}` and does not insert
- [ ] INSERT uses `ON CONFLICT DO NOTHING` on both `file_path` and `file_hash` unique constraints

### US-004: Extract EPUB metadata (text only)

**Description:** As a developer, I want EPUB metadata extracted so that title, author, and description are stored in the database.

**Acceptance Criteria:**
- [ ] Opens the EPUB file as a ZIP archive
- [ ] Locates and parses the OPF package document (`content.opf` or equivalent referenced in `META-INF/container.xml`)
- [ ] Extracts `<dc:title>`, `<dc:creator>`, `<dc:description>` from the OPF metadata
- [ ] Falls back to the filename (without extension) if title is missing or empty
- [ ] `cover_path` is set to `NULL` (cover generation is out of scope)

### US-005: Extract PDF metadata (text only)

**Description:** As a developer, I want PDF metadata extracted so that title, author, page count, and description are stored in the database.

**Acceptance Criteria:**
- [ ] Reads PDF Info dictionary for `Title`, `Author` fields
- [ ] Counts total pages
- [ ] Falls back to the filename (without extension) if title is missing or empty
- [ ] `cover_path` is set to `NULL` (cover generation is out of scope)

### US-006: Insert book records into SQLite

**Description:** As a developer, I want the watcher to insert book records into the existing `books` table so that the app can display them.

**Acceptance Criteria:**
- [ ] Generates a UUID v4 for the `id` column
- [ ] Sets `file_type` to `"pdf"` or `"epub"`
- [ ] Sets `file_path` to the absolute path of the file
- [ ] Sets `file_size` to the file size in bytes
- [ ] Sets `file_hash` to the hex-encoded SHA-256 hash
- [ ] Sets `added_at` and `updated_at` to current Unix timestamp (seconds)
- [ ] Sets `cover_path` to `NULL`
- [ ] Sets `page_count` from metadata (or `NULL` if unavailable)
- [ ] Uses `INSERT ... ON CONFLICT DO NOTHING`
- [ ] After successful insert, increments `library_version` in the `settings` table

### US-007: Handle file changes

**Description:** As a developer, I want the watcher to detect when a tracked file's content changes and update its metadata.

**Acceptance Criteria:**
- [ ] On file change event, looks up existing `books` row by `file_path`
- [ ] If no row exists, treats it as an add
- [ ] Skips zero-byte files
- [ ] Re-hashes the file; skips if hash is unchanged (logs `[SKIP] Hash unchanged for "{title}"`)
- [ ] Re-extracts metadata and updates the row: `title`, `author`, `description`, `file_size`, `file_hash`, `page_count`, `updated_at`
- [ ] Sets `cover_path` to `NULL` (no cover re-generation)
- [ ] Increments `library_version` after update

### US-008: Handle file deletions

**Description:** As a developer, I want the watcher to clean up database records when files are removed from the library.

**Acceptance Criteria:**
- [ ] On unlink event, looks up `books` row by `file_path`
- [ ] If a row exists and has a `cover_path`, attempts to delete the cover file (ignores if already gone)
- [ ] Deletes the `books` row (FK CASCADE handles `reading_progress` and `collection_books`)
- [ ] Logs `[DELETE] Removed "{title}" from library`
- [ ] If no row exists, logs `[WARN] No DB record for deleted file: {path}`
- [ ] Increments `library_version` after deletion

### US-009: Orphan cleanup on startup

**Description:** As a developer, I want stale database entries cleaned up on startup so that books whose files have been removed while the watcher was stopped are pruned.

**Acceptance Criteria:**
- [ ] After the initial scan completes (all existing files processed), queries all `books` rows
- [ ] For each row, checks if `file_path` exists on disk
- [ ] If the file is missing: deletes cover file (if `cover_path` set), deletes the `books` row
- [ ] Logs `[SCAN] Removed orphan: "{title}"` for each removed entry
- [ ] Logs `[SCAN] Cleaned up {n} orphaned entry(ies).` if any were removed

### US-010: Library version signaling

**Description:** As a developer, I want the watcher to increment the `library_version` setting after every mutation so that the SSE endpoint can notify connected clients.

**Acceptance Criteria:**
- [ ] After every successful add, update, or delete, upserts the `settings` row with `key = "library_version"`
- [ ] Sets `value` to the current Unix timestamp (seconds) as a string
- [ ] Sets `updated_at` to the same timestamp
- [ ] Uses `INSERT ... ON CONFLICT DO UPDATE` (matching the TypeScript `onConflictDoUpdate` behavior)

### US-011: Configuration via CLI args and environment variables

**Description:** As a developer, I want to configure paths via CLI arguments or environment variables so the watcher works in both development and production contexts.

**Acceptance Criteria:**
- [ ] Accepts `--library-path` / `LIBRARY_PATH` (default: `./data/library`)
- [ ] Accepts `--db-path` / `DATABASE_PATH` (default: `./data/library.db`)
- [ ] Accepts `--covers-path` / `COVERS_PATH` (default: `./data/covers`)
- [ ] CLI arguments take precedence over environment variables
- [ ] Creates the library directory if it does not exist

### US-012: Logging

**Description:** As a developer, I want log output that matches the existing TypeScript watcher so I can compare behavior during migration.

**Acceptance Criteria:**
- [ ] Log format: `[{ISO-8601 timestamp}] {message}` (e.g., `[2025-06-15T10:30:00.000Z] [OK] Added "Book Title" (pdf)`)
- [ ] Log prefixes match TypeScript watcher: `[SKIP]`, `[OK]`, `[UPDATE]`, `[DELETE]`, `[WARN]`, `[ERROR]`, `[SCAN]`, `[INFO]`
- [ ] Startup message: `Watching {path} for .pdf and .epub files...`
- [ ] Initial scan progress: `[SCAN] Processed {n} files...` every 10 files
- [ ] Initial scan complete: `[SCAN] Initial scan complete -- {n} file(s) found.`

### US-013: Integration tests

**Description:** As a developer, I want integration tests that verify database state after watching a test directory so I can trust the watcher's behavior.

**Acceptance Criteria:**
- [ ] Test fixture directory with sample `.pdf` and `.epub` files
- [ ] Test: adding a new PDF creates a `books` row with correct `file_type`, `file_hash`, and extracted `title`
- [ ] Test: adding a new EPUB creates a `books` row with correct metadata
- [ ] Test: adding a duplicate file (same content, different path) does not create a second row
- [ ] Test: deleting a file removes the `books` row
- [ ] Test: orphan cleanup removes rows for missing files
- [ ] Test: `library_version` in `settings` table is incremented after add/delete
- [ ] Tests use a temporary SQLite database and temporary directory, cleaned up after each run

## Functional Requirements

- FR-1: The binary must watch a configured directory recursively for `.pdf` and `.epub` files
- FR-2: File events must be debounced with a 2-second stability threshold (no processing until file size is stable for 2s)
- FR-3: Zero-byte files must be skipped
- FR-4: Files must be SHA-256 hashed in full; duplicates (by hash) must be skipped
- FR-5: EPUB metadata must be extracted by parsing `META-INF/container.xml` to find the OPF, then reading `<dc:title>`, `<dc:creator>`, `<dc:description>` from the OPF
- FR-6: PDF metadata must be extracted from the Info dictionary (`Title`, `Author`) and page count must be determined
- FR-7: Book records must be inserted into the `books` table with UUID v4 IDs, Unix timestamps (seconds), and `ON CONFLICT DO NOTHING`
- FR-8: File changes must re-hash, skip if unchanged, re-extract metadata, and update the existing row
- FR-9: File deletions must remove the `books` row and any associated cover file
- FR-10: After the initial scan, all `books` rows whose `file_path` no longer exists on disk must be deleted
- FR-11: After every add, update, or delete, the `settings.library_version` row must be upserted with the current Unix timestamp
- FR-12: The binary must connect to an existing SQLite database in WAL mode with foreign keys enabled
- FR-13: The binary must not create or migrate database tables (the database is assumed to already exist)
- FR-14: The binary must handle `SIGINT` and `SIGTERM` gracefully (stop watching, close DB connection, exit)

## Non-Goals

- Cover image generation (PDF rendering or EPUB cover extraction) -- separate PRD
- Database schema creation or migration -- the existing app handles this
- HTTP server or API routes -- the existing Next.js server handles this
- Tauri integration -- this is a standalone binary for Phase 1
- Windows service or launchd integration
- Hot-reload or self-update
- Structured/JSON logging (plain text matching current format)

## Technical Considerations

### Crate Dependencies

| Crate | Purpose |
|-------|---------|
| `notify` (v7+) | File system watching (cross-platform) |
| `sha2` | SHA-256 hashing |
| `rusqlite` (with `bundled` feature) | SQLite access with statically linked SQLite |
| `uuid` (with `v4` feature) | UUID generation |
| `zip` | EPUB archive reading |
| `quick-xml` | OPF/container.xml parsing |
| `lopdf` | PDF metadata and page count extraction |
| `clap` | CLI argument parsing |
| `chrono` | ISO-8601 timestamp formatting for logs |

### SQLite Concurrency

The Rust watcher and the Next.js server will both access the same SQLite file. WAL mode (already enabled by the app) allows concurrent readers with a single writer. The watcher should open with `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON`, matching the existing connection setup. Write transactions should be short to minimize lock contention.

### Debouncing Strategy

The `notify` crate does not have a built-in `awaitWriteFinish` equivalent. Implement debouncing with:
1. On file event, record `(path, timestamp)` in a `HashMap`
2. A background task checks every 500ms for entries older than 2 seconds whose file size has not changed since last check
3. Stable entries are dispatched for processing and removed from the map

### Existing Database Schema

The watcher writes to the `books` table and the `settings` table only. It does not touch `users`, `reading_progress`, `collections`, or `collection_books`. The schema is documented in `src/lib/db/schema.ts` and the `books` table columns are:

```
id            TEXT PRIMARY KEY
title         TEXT NOT NULL
author        TEXT
description   TEXT
file_type     TEXT NOT NULL        -- "pdf" or "epub"
file_path     TEXT NOT NULL UNIQUE
file_size     INTEGER NOT NULL
file_hash     TEXT NOT NULL UNIQUE
cover_path    TEXT
page_count    INTEGER
added_at      INTEGER NOT NULL     -- Unix timestamp (seconds)
updated_at    INTEGER NOT NULL     -- Unix timestamp (seconds)
```

The `settings` table:

```
key           TEXT PRIMARY KEY
value         TEXT NOT NULL
updated_at    INTEGER NOT NULL     -- Unix timestamp (seconds)
```

### Project Structure (suggested)

```
watcher-rs/
  Cargo.toml
  src/
    main.rs           -- CLI parsing, setup, signal handling
    watcher.rs        -- notify setup, debounce loop, event dispatch
    handlers/
      mod.rs
      add.rs          -- handleAdd equivalent
      change.rs       -- handleChange equivalent
      delete.rs       -- handleDelete equivalent
    extractors/
      mod.rs
      epub.rs         -- ZIP + OPF metadata parsing
      pdf.rs          -- lopdf metadata + page count
    db.rs             -- rusqlite connection, queries, library version
    log.rs            -- timestamped log output
  tests/
    integration.rs    -- integration tests with temp DB + temp directory
    fixtures/
      sample.pdf
      sample.epub
```

## Success Metrics

- All integration tests pass against a fresh SQLite database
- Running the Rust watcher against a library of 100+ mixed PDF/EPUB files produces the same set of `books` rows (by `file_hash`) as the TypeScript watcher, minus `cover_path`
- The Rust watcher can run simultaneously with the existing Electron app without database corruption or lock errors

## Open Questions

- Should the watcher support a `--verbose` flag for debug-level output, or is matching the current log level sufficient for now?
- Should the debounce implementation use async Rust (`tokio`) or synchronous threads? `tokio` is more natural for timers but adds compilation overhead for what is otherwise a synchronous program.
- Should the integration tests include a stress test (e.g., 1000 files added rapidly) to validate debouncing under load?
