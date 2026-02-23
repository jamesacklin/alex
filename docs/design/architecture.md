# System Architecture

This document describes the overall architecture of Alex, a self-hosted personal library management system.

## Overview

Alex is built as a modern web application with the following key components:

- **Next.js 16** - Full-stack React framework with App Router
- **SQLite** - Embedded database for metadata and user data, accessed via a Rust bridge binary (`watcher-rs`)
- **Rust Ingestion Engine** - Standalone Rust binary (`watcher-rs`) that runs in local-folder or S3-polling mode
- **Source-aware File Serving** - Unified source driver pipeline for local and S3-backed book streaming
- **Real-time Updates** - Server-Sent Events (SSE) for live library updates
- **Multi-format Readers** - PDF.js for PDFs, epub.js for EPUBs

## Architecture Diagram

```mermaid
graph TB
    subgraph "Client Browser"
        UI[React UI]
        SSE[EventSource SSE Client]
        PDF[PDF.js Reader]
        EPUB[epub.js Reader]
    end

    subgraph "Public Viewer Browser"
        PubUI[Shared Collection UI]
        PubPDF[PDF.js Reader]
        PubEPUB[epub.js Reader]
        LocalStorage[localStorage<br/>Reading Progress]
    end

    subgraph "Next.js App Router"
        Pages[Pages & Layouts]
        API[API Routes]
        SourceDriver[Source Driver<br/>serveBookFile + SOURCE_HANDLERS]
        Auth[NextAuth.js]
        SSEEndpoint[/api/library/events]
    end

    subgraph "Storage Backends"
        LibFolder[Library Folder<br/>~/library]
        S3Bucket[S3 / R2 Bucket]
        Covers[Cover Images<br/>data/covers/]
        DB[(SQLite Database<br/>library.db)]
    end

    subgraph "Rust Watcher (watcher-rs)"
        Notify[notify crate<br/>File Watcher]
        S3Poll[S3 Poller]
        HandleAdd[handle_add]
        HandleChange[handle_change]
        HandleDelete[handle_delete]
        S3HandleAdd[handle_s3_add]
        S3HandleChange[handle_s3_change]
        S3HandleDelete[handle_s3_delete]
        Extract[Metadata Extractors<br/>lopdf / quick-xml]
        CoverGen[Cover Generator<br/>pdfium-render / ab_glyph]
    end

    %% User Interactions
    UI -->|Login| Auth
    UI -->|Browse Library| Pages
    UI -->|Search/Filter| API
    UI -->|Read Book| PDF
    UI -->|Read Book| EPUB
    UI -->|Connect| SSE

    %% Authentication Flow
    Auth -->|Validate Credentials| DB
    Auth -->|Create Session JWT| UI

    %% Library Browse Flow
    Pages -->|Fetch Books| API
    Pages -->|Fetch Now Reading| API
    API -->|Query Books| DB
    API -->|Query reading status=reading| DB
    API -->|Return JSON| UI

    %% Real-time Updates
    SSE -->|Subscribe| SSEEndpoint
    SSEEndpoint -->|Poll Every 2s| DB
    SSEEndpoint -->|library_version| SSE
    SSE -->|Show Refresh Banner| UI

    %% Local File Watching Flow
    LibFolder -.->|File Added/Changed/Deleted| Notify
    Notify -->|add| HandleAdd
    Notify -->|change| HandleChange
    Notify -->|remove| HandleDelete

    %% S3 Polling Flow
    S3Poll -.->|ListObjects diff| S3Bucket
    S3Poll -->|added| S3HandleAdd
    S3Poll -->|changed| S3HandleChange
    S3Poll -->|removed| S3HandleDelete

    %% Add Book Flow
    HandleAdd -->|Read File| LibFolder
    HandleAdd -->|Extract Metadata| Extract
    HandleAdd -->|Generate Cover| CoverGen
    CoverGen -->|Save PNG| Covers
    HandleAdd -->|Insert Book Record| DB
    HandleAdd -->|incrementLibraryVersion| DB

    %% Change Book Flow
    HandleChange -->|Re-extract Metadata| Extract
    HandleChange -->|Update Record| DB
    HandleChange -->|incrementLibraryVersion| DB

    %% Delete Book Flow
    HandleDelete -->|Delete Record| DB
    HandleDelete -->|Remove Cover| Covers
    HandleDelete -->|incrementLibraryVersion| DB

    %% S3 Add/Change/Delete Flow
    S3HandleAdd -->|GetObject| S3Bucket
    S3HandleAdd -->|Extract Metadata| Extract
    S3HandleAdd -->|Generate Cover| CoverGen
    S3HandleAdd -->|Insert Book Record| DB
    S3HandleAdd -->|incrementLibraryVersion| DB
    S3HandleChange -->|GetObject + compare hash| S3Bucket
    S3HandleChange -->|Update Book + s3_etag| DB
    S3HandleChange -->|incrementLibraryVersion| DB
    S3HandleDelete -->|Delete Record| DB
    S3HandleDelete -->|Remove Cover| Covers
    S3HandleDelete -->|incrementLibraryVersion| DB

    %% Reading Flow - PDF
    PDF -->|Request Page| API
    API -->|resolve source| SourceDriver
    SourceDriver -->|local| LibFolder
    SourceDriver -->|s3-stream| S3Bucket
    PDF -->|Save Progress| API
    API -->|Update Progress| DB

    %% Reading Flow - EPUB
    EPUB -->|Request Book| API
    API -->|resolve source| SourceDriver
    SourceDriver -->|local| LibFolder
    SourceDriver -->|s3-stream| S3Bucket
    EPUB -->|Save Location| API
    API -->|Update Progress| DB

    %% Public Collection Flow
    PubUI -->|Browse Collection| API
    API -->|/api/shared/[token]| DB
    API -->|/api/shared/[token]/covers/[bookId]| Covers
    PubUI -->|Read Book| PubPDF
    PubUI -->|Read Book| PubEPUB
    PubPDF -->|Request File| API
    API -->|resolve source| SourceDriver
    SourceDriver -->|local| LibFolder
    SourceDriver -->|s3-stream| S3Bucket
    PubEPUB -->|Request File| API
    API -->|resolve source| SourceDriver
    SourceDriver -->|local| LibFolder
    SourceDriver -->|s3-stream| S3Bucket
    PubPDF -->|Save Progress| LocalStorage
    PubEPUB -->|Save Progress| LocalStorage

    %% Database Tables
    subgraph "Database Schema"
        Users[users]
        Books[books]
        Progress[reading_progress]
        Collections[collections]
        Settings[settings<br/>library_version]
    end

    DB -.-> Users
    DB -.-> Books
    DB -.-> Progress
    DB -.-> Collections
    DB -.-> Settings

    %% Styling
    classDef client fill:#e1f5ff,stroke:#01579b
    classDef server fill:#f3e5f5,stroke:#4a148c
    classDef storage fill:#fff3e0,stroke:#e65100
    classDef process fill:#e8f5e9,stroke:#1b5e20

    class UI,SSE,PDF,EPUB client
    class PubUI,PubPDF,PubEPUB,LocalStorage client
    class Pages,API,SourceDriver,Auth,SSEEndpoint server
    class LibFolder,S3Bucket,Covers,DB,Users,Books,Progress,Collections,Settings storage
    class Notify,S3Poll,HandleAdd,HandleChange,HandleDelete,S3HandleAdd,S3HandleChange,S3HandleDelete,Extract,CoverGen process
```

## Component Descriptions

### Client Browser

**React UI**
- Next.js App Router with client/server components
- Tailwind CSS v4 for styling
- shadcn/ui component library
- Responsive design for mobile and desktop
- Floating tab bar navigation for primary routes (Library, Collections, Admin)
- Pill-style filters for library and collection browsing
- Sliding underline tabs for admin panel sections

**EventSource SSE Client**
- Maintains persistent connection to `/api/library/events`
- Receives real-time library update notifications
- Automatically reconnects on connection loss

**PDF.js Reader**
- Browser-based PDF rendering
- Page navigation, zoom controls
- Fit-to-width and continuous scrolling
- Full-text search across documents

**epub.js Reader**
- Reflowable EPUB rendering via react-reader
- Table of contents navigation
- Chapter skipping
- Continuous vertical scrolling
- `80ch` reading column with themed typography (IBM Plex Serif)
- Header progress meter with precise percentage display
- Scroll-fraction restore when viewport dimensions match the saved session

### Next.js App Router

**Pages & Layouts**
- `/library` - Main library grid view with search and filters
- `/collections` - User's collections list
- `/collections/[id]` - Collection detail with edit/delete/share controls
- `/read/[bookId]` - Book reader (PDF or EPUB)
- `/shared/[token]` - Public collection view (no auth required)
- `/shared/[token]/read/[bookId]` - Public book reader (no auth required)
- `/admin/general` - General admin settings (admin only)
- `/admin/users` - User management (admin only)
- `/admin/library` - Library management and bulk operations (admin only)
- `/login` - Authentication page
- `/onboarding` - First-run setup flow
- `/setup` - Initial admin account setup

**API Routes**

Authenticated:
- `GET /api/books` - List books with pagination, search, filters
- `GET /api/books/now-reading` - List current user's books where `reading_progress.status='reading'`
- `GET /api/books/[id]` - Get book metadata
- `GET /api/books/[id]/file` - Serve book file (PDF or EPUB)
- `GET /api/books/[id]/book.epub` - Serve EPUB file
- `GET /api/books/[id]/cover` - Serve cover image
- `GET /api/books/[id]/progress` - Get reading progress
- `PUT /api/books/[id]/progress` - Update reading progress
- `GET /api/collections` - List user's collections
- `POST /api/collections` - Create collection
- `GET /api/collections/[id]` - Get collection with books
- `GET /api/collections/[id]/now-reading` - List currently reading books in a specific collection
- `PUT /api/collections/[id]` - Update collection
- `DELETE /api/collections/[id]` - Delete collection
- `POST /api/collections/[id]/share` - Enable sharing (generates token)
- `DELETE /api/collections/[id]/share` - Disable sharing (revokes token)
- `GET /api/collections/[id]/share` - Check share status
- `GET /api/library/events` - SSE endpoint for real-time updates

Public (no auth):
- `GET /api/shared/[token]` - Public collection metadata and paginated book list
- `GET /api/shared/[token]/covers/[bookId]` - Public cover image (scoped to collection)
- `GET /api/shared/[token]/books/[bookId]/file` - Public book file streaming (scoped to collection)
- `GET /api/shared/[token]/books/[bookId]/book.epub` - Public EPUB file (scoped to collection)

All four book-file endpoints (authenticated + public, PDF + EPUB) delegate to the same source-aware helper: `src/lib/files/serve-book-file.ts`.

**NextAuth.js**
- Credential-based authentication
- JWT sessions
- Role-based access control (admin/user)
- Bcrypt password hashing
- Middleware exempts `/shared/*` and `/api/shared/*` from auth

**SSE Endpoint**
- Long-lived HTTP connection for Server-Sent Events
- Polls database every 2 seconds for library version changes
- Pushes update events to all connected clients
- Automatic keepalive every 15 seconds

### Source Driver Pipeline

`serveBookFile()` resolves `books.source` and dispatches to `SOURCE_HANDLERS`:

- `local` driver streams from `file_path` on disk with HTTP range support.
- `s3` driver validates env config and streams via `watcher-rs s3-stream`.

This keeps route behavior consistent across:

- `/api/books/[id]/file`
- `/api/books/[id]/book.epub`
- `/api/shared/[token]/books/[bookId]/file`
- `/api/shared/[token]/books/[bookId]/book.epub`

Adding another provider is a single registry extension, not a route rewrite.

### Storage Backends

**Local Library Folder**
- User-specified directory (default: `./data/library`)
- Contains PDF and EPUB files
- Monitored in local mode via `notify`
- Mounted as Docker volume

**S3-compatible Bucket**
- Supports Cloudflare R2, AWS S3, MinIO, and compatible APIs
- Enabled when runtime config includes `S3_BUCKET` (+ credentials)
- Objects are scanned/polled by `watcher-rs`; `books.file_path` stores the object key
- Book bytes are streamed on demand via `watcher-rs s3-stream`

**Cover Images**
- PNG files generated from first page
- Stored in `./data/covers/`
- Named by book UUID
- Served via API route

**SQLite Database**
- Single-file database at `./data/library.db`
- Accessed from Rust via `rusqlite` (statically linked SQLite)
- Next.js accesses the database through the `watcher-rs` binary's `db` subcommand (JSON over stdin/stdout)
- Schema applied via SQL migration files executed through the Rust bridge (`scripts/db-push.js`)

### Rust Watcher (`watcher-rs`)

The watcher is a standalone Rust binary that handles ingestion, metadata extraction, cover generation, and database writes. It also exposes `db` and `s3-stream` subcommands used by the Next.js app.

**Ingestion Modes**
- Local mode: `notify` watches the library folder recursively for add/change/delete events
- S3 mode: periodic object listing + diff on bucket/prefix (`S3_POLL_INTERVAL`)
- Runtime chooses mode from config (`S3_BUCKET` set => S3 mode; otherwise local mode)

**Event Handlers**
- `handle_add` - New file detected: extract metadata, generate cover, insert DB record
- `handle_change` - Existing file modified: re-hash, re-extract metadata, update DB record
- `handle_delete` - File removed: delete DB record and cover image
- `handle_s3_add` / `handle_s3_change` / `handle_s3_delete` - Equivalent S3 object lifecycle handlers
- Orphan cleanup on startup applies to local books; S3 removals are diff-driven by the poller

**Metadata Extractors**
- PDF: `lopdf` for reading the Info dictionary (title, author, page count)
- EPUB: `zip` + `quick-xml` for parsing `META-INF/container.xml` and the OPF package document (`dc:title`, `dc:creator`, `dc:description`)
- Fallback to filename parsing if metadata unavailable

**Cover Generator**
- PDF: `pdfium-render` with statically linked PDFium renders page 1 at 150 DPI as JPEG
- EPUB: cover image extracted from the ZIP archive (re-encoded to JPEG if needed)
- Fallback: synthetic gradient cover (400x600px) with title/author text rendered via `ab_glyph` + `imageproc`

**Database Bridge**
- The `watcher-rs db` subcommand accepts `query-all`, `query-one`, or `execute` modes
- Receives a JSON request (`{sql, params}`) on stdin, returns JSON on stdout
- Next.js calls this via `src/lib/db/rust.ts`, which spawns the binary as a child process
- This replaces the previous `better-sqlite3` + Drizzle ORM setup

**S3 Stream Bridge**
- The `watcher-rs s3-stream` subcommand streams object bytes to stdout with a JSON header
- Next.js uses this for ranged/full responses while preserving the same HTTP contract as local files

## Data Flow

### Book Ingestion
1. Runtime starts watcher in local mode or S3 mode.
2. Local mode: `notify` detects file events from library folder.  
   S3 mode: poller computes added/changed/removed object diff.
3. Handler reads file/object bytes, computes SHA-256, and checks duplicates.
4. Extract metadata via `lopdf` (PDF) or `quick-xml` + `zip` (EPUB).
5. Generate cover (`pdfium-render`, EPUB extraction, or synthetic fallback).
6. Insert/update/delete `books` rows (including `source`, `s3_bucket`, `s3_etag` for S3 records).
7. Increment `settings.library_version`.
8. SSE endpoint detects the version bump and clients refresh.

### Reading Experience
1. User clicks book card in library
2. Navigate to `/read/[bookId]`
3. Fetch book metadata from API
4. Fetch reading progress for current user
5. Load appropriate reader (PDF.js or epub.js)
6. API resolves `books.source` through source drivers (local disk vs S3 stream)
7. Render at last saved position
8. For EPUB, restore saved scroll fraction when viewport dimensions still match
9. On page/location change, debounce progress update
10. Calculate percentage complete
11. Update `reading_progress` table
12. Update book status (not_started → reading → completed)

### Now Reading Shelf Loading
1. Client fetches `/api/books/now-reading` on the library page (or `/api/collections/[id]/now-reading` in collection detail)
2. Server filters to `reading_progress.status='reading'` for the current user
3. Results are ordered by `reading_progress.last_read_at DESC`
4. Client renders a dedicated "Now Reading" section
5. Client excludes those IDs from the paginated "All Books" list to avoid duplicates and load-loop churn

### Public Collection Sharing
1. Collection owner clicks "Share" on collection detail page
2. Client calls `POST /api/collections/[id]/share`
3. Server generates `crypto.randomUUID()` token, stores in `collections.shareToken`
4. Server returns share URL: `/shared/<token>`
5. Owner copies and sends the URL to recipient

### Public Collection Viewing
1. Recipient opens `/shared/<token>` — no login required
2. Server validates token via `getSharedCollection(token)` helper
3. If valid, renders collection name, description, and paginated book grid
4. Cover images served via `/api/shared/[token]/covers/[bookId]` (validates book membership)
5. Recipient clicks a book card to open the public reader at `/shared/[token]/read/[bookId]`
6. Public reader loads the same `PdfReader`/`EpubReader` components as authenticated users
7. Book files served via `/api/shared/[token]/books/[bookId]/file` (validates book membership)
8. Reading progress saved to browser `localStorage` (key: `shared-progress:<token>:<bookId>`)
9. No server-side state created for anonymous readers

### Real-time Updates
1. Client opens library page
2. Establish SSE connection to `/api/library/events`
3. Server sends initial "connected" message
4. Server polls `settings.library_version` every 2 seconds
5. When version changes, server pushes "library-update" event
6. Client receives event and shows a refresh banner (instead of auto-refresh)
7. User clicks refresh, then client refetches `/api/books`
8. UI updates with new/changed/deleted books
9. Connection maintained with keepalive pings

## Deployment Architecture

### Development
- Next.js dev server on port 3000
- Rust watcher (`watcher-rs`) runs in a separate terminal via `pnpm watcher`
- `pnpm watcher` auto-selects local vs S3 mode based on env vars
- SQLite database in `./data/library.db`
- Requires a Rust toolchain (`rustup`) for building the watcher binary
- Hot module replacement for fast iteration

### Production (Docker)
- Single container with Node.js 22 and the pre-compiled `watcher-rs` binary
- Watcher runs as a backgrounded process alongside the Next.js server (local or S3 mode)
- Next.js production server (standalone mode)
- Persistent Docker volume for `/app/data`
- Environment variables for configuration (`DATABASE_PATH`, `LIBRARY_PATH`, `COVERS_PATH`, `S3_*`)

### Desktop (Electron)
- Cross-platform desktop application for macOS, Windows, and Linux
- Embedded Next.js server running on localhost:3210
- Rust watcher (`watcher-rs`) binary bundled as a resource, spawned and supervised by Electron
- SQLite database and library stored in platform-specific app data directory
- User-selectable storage mode in onboarding/admin (`Local Folder` or `S3 / R2 Bucket`)
- Auto-updater support for seamless updates
- Platform-specific builds:
  - macOS: .app bundle (Apple Silicon)
  - Windows: .exe installer (x64)
  - Linux: AppImage and .deb packages
- First-run setup flow for admin account creation
- Native file system access for library management

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Next.js 16 |
| Styling | Tailwind CSS v4, shadcn/ui |
| Authentication | NextAuth.js v5 |
| Database | SQLite via Rust (`rusqlite`, statically linked); Next.js accesses DB through the `watcher-rs` binary bridge |
| Ingestion | Rust `notify` (local mode) or S3 poller (S3 mode), both in `watcher-rs` |
| File Serving | Source-driver pipeline (`serveBookFile` + `SOURCE_HANDLERS`) |
| PDF Rendering | PDF.js (browser) |
| EPUB Rendering | epub.js, react-reader |
| PDF/EPUB Metadata | `lopdf`, `quick-xml` + `zip` (Rust, in `watcher-rs`) |
| Cover Generation | `pdfium-render` (statically linked PDFium), `ab_glyph` + `imageproc` fallback (Rust, in `watcher-rs`) |
| Real-time | Server-Sent Events (SSE) |
| Deployment | Docker, Electron, Node.js 22, Rust toolchain (build-time) |
