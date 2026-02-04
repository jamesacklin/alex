# PRD: Phase 3 - File Watcher Service

## Introduction

Create a separate Node.js process that watches a configured directory for PDF and ePub files, extracts metadata (title, author, cover), and updates the SQLite database directly. This enables the "Plex-like" experience where adding files to a folder automatically populates the library.

## Goals

- Automatically detect new, modified, and deleted files in the library directory
- Extract metadata (title, author, description, cover) from PDF and ePub files
- Keep database in sync with filesystem state
- Run independently from the Next.js application

## User Stories

### US-3.1: Create Watcher Process
**Description:** As a system, I need a long-running process to watch the library directory for file changes.

**Acceptance Criteria:**
- [ ] `watcher/index.ts` entry point
- [ ] Uses chokidar to watch `LIBRARY_PATH` environment variable
- [ ] Watches for `.pdf` and `.epub` files recursively
- [ ] `pnpm watcher` script in package.json to start
- [ ] Logs file events to console with timestamps
- [ ] Handles `SIGINT`/`SIGTERM` for graceful shutdown

### US-3.2: Handle File Addition
**Description:** As a system, when a new file is added to the library, extract metadata and add to database.

**Acceptance Criteria:**
- [ ] Detect `add` event from chokidar
- [ ] Calculate SHA-256 hash of file contents
- [ ] Skip processing if hash already exists in database (duplicate file)
- [ ] Extract metadata based on file type (PDF or ePub)
- [ ] Generate UUID for book id
- [ ] Insert book record into database
- [ ] Log success with book title, or log failure with error

### US-3.3: Handle File Deletion
**Description:** As a system, when a file is deleted from the library, remove it from the database.

**Acceptance Criteria:**
- [ ] Detect `unlink` event from chokidar
- [ ] Find book record by filePath
- [ ] Delete book record (cascades to reading_progress, collection_books via foreign keys)
- [ ] Delete cover image file if exists
- [ ] Log removal with book title

### US-3.4: Handle File Modification
**Description:** As a system, when a file is modified, update its metadata if the content changed.

**Acceptance Criteria:**
- [ ] Detect `change` event from chokidar
- [ ] Recalculate file hash
- [ ] If hash unchanged, skip processing
- [ ] If hash changed, re-extract metadata
- [ ] Update book record with new metadata
- [ ] Update cover image if different

### US-3.5: PDF Metadata Extraction
**Description:** As a system, I need to extract metadata from PDF files.

**Acceptance Criteria:**
- [ ] `watcher/extractors/pdf.ts` module
- [ ] Uses `pdf-parse` library
- [ ] Extracts: title (from metadata or filename), author, page count
- [ ] Falls back to filename (without extension) for title if not in PDF metadata
- [ ] Handles extraction errors gracefully (use filename as title)

### US-3.6: ePub Metadata Extraction
**Description:** As a system, I need to extract metadata from ePub files.

**Acceptance Criteria:**
- [ ] `watcher/extractors/epub.ts` module
- [ ] Uses `epub2` library
- [ ] Extracts: title, author, description, publisher, language
- [ ] Extracts cover image from ePub package
- [ ] Saves cover to `data/covers/[bookId].jpg`
- [ ] Handles missing cover gracefully (no cover saved)

### US-3.7: Initial Library Scan
**Description:** As a system, on startup, scan existing files to ensure database is in sync with filesystem.

**Acceptance Criteria:**
- [ ] On watcher start, process all existing files in library
- [ ] Use chokidar option `ignoreInitial: false`
- [ ] Use `awaitWriteFinish: { stabilityThreshold: 2000 }` for large files
- [ ] Log scan start, progress (every 10 files), and completion
- [ ] Remove database entries for files that no longer exist on disk

## Functional Requirements

- FR-3.1: Watcher runs as separate Node.js process (not inside Next.js)
- FR-3.2: Watches `LIBRARY_PATH` recursively for `.pdf` and `.epub` files
- FR-3.3: Handles `add`, `change`, `unlink` events from chokidar
- FR-3.4: Extracts metadata using `pdf-parse` for PDFs
- FR-3.5: Extracts metadata using `epub2` for ePubs
- FR-3.6: Stores cover images in `data/covers/` directory
- FR-3.7: Uses SHA-256 file hash for change detection and deduplication
- FR-3.8: Writes directly to SQLite database (same file as Next.js app)
- FR-3.9: Cleans up orphaned database entries on startup

## Non-Goals

- No real-time push notifications to frontend (frontend will poll or refresh)
- No message queue or job system
- No distributed processing or multiple watchers
- No cover extraction from PDFs (complex, low value)

## Technical Considerations

- Use `awaitWriteFinish: { stabilityThreshold: 2000 }` to handle files being copied
- Database connection uses same `DATABASE_PATH` as Next.js app
- Run with `tsx watcher/index.ts` for TypeScript execution
- For development, use `tsx watch watcher/index.ts` for auto-reload
- chokidar options: `ignored: /(^|[\/\\])\../` to skip dotfiles
- Consider adding a processing queue if many files added simultaneously

## Success Metrics

- Adding a PDF to library folder creates database entry within 5 seconds
- Adding an ePub extracts metadata and cover image
- Deleting a file removes it from database
- Duplicate files (same hash) are not added twice
- Watcher survives and recovers from file processing errors

## Open Questions

- None - requirements are fully specified
