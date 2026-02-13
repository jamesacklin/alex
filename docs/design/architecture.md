# System Architecture

This document describes the overall architecture of Alex, a self-hosted personal library management system.

## Overview

Alex is built as a modern web application with the following key components:

- **Next.js 16** - Full-stack React framework with App Router
- **SQLite** - Embedded database for metadata and user data
- **File System Watcher** - Background process monitoring the library folder
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
        Auth[NextAuth.js]
        SSEEndpoint[/api/library/events]
    end

    subgraph "File System"
        LibFolder[Library Folder<br/>~/library]
        Covers[Cover Images<br/>data/covers/]
        DB[(SQLite Database<br/>library.db)]
    end

    subgraph "Watcher Process"
        Chokidar[Chokidar<br/>File Watcher]
        HandleAdd[handleAdd]
        HandleChange[handleChange]
        HandleDelete[handleDelete]
        Extract[Metadata Extractors<br/>PDF/EPUB]
        CoverGen[Cover Generator<br/>pdftoppm/canvas]
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

    %% File Watching Flow
    LibFolder -.->|File Added/Changed/Deleted| Chokidar
    Chokidar -->|add| HandleAdd
    Chokidar -->|change| HandleChange
    Chokidar -->|unlink| HandleDelete

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

    %% Reading Flow - PDF
    PDF -->|Request Page| API
    API -->|/api/books/[id]/file| LibFolder
    PDF -->|Save Progress| API
    API -->|Update Progress| DB

    %% Reading Flow - EPUB
    EPUB -->|Request Book| API
    API -->|/api/books/[id]/book.epub| LibFolder
    EPUB -->|Save Location| API
    API -->|Update Progress| DB

    %% Public Collection Flow
    PubUI -->|Browse Collection| API
    API -->|/api/shared/[token]| DB
    API -->|/api/shared/[token]/covers/[bookId]| Covers
    PubUI -->|Read Book| PubPDF
    PubUI -->|Read Book| PubEPUB
    PubPDF -->|Request File| API
    API -->|/api/shared/[token]/books/[bookId]/file| LibFolder
    PubEPUB -->|Request File| API
    API -->|/api/shared/[token]/books/[bookId]/book.epub| LibFolder
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
    class Pages,API,Auth,SSEEndpoint server
    class LibFolder,Covers,DB,Users,Books,Progress,Collections,Settings storage
    class Chokidar,HandleAdd,HandleChange,HandleDelete,Extract,CoverGen process
```

## Component Descriptions

### Client Browser

**React UI**
- Next.js App Router with client/server components
- Tailwind CSS v4 for styling
- shadcn/ui component library
- Responsive design for mobile and desktop

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
- `/admin/users` - User management (admin only)
- `/login` - Authentication page

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

### File System

**Library Folder**
- User-specified directory (default: `./data/library`)
- Contains PDF and EPUB files
- Monitored by file watcher
- Mounted as Docker volume

**Cover Images**
- PNG files generated from first page
- Stored in `./data/covers/`
- Named by book UUID
- Served via API route

**SQLite Database**
- Single-file database at `./data/library.db`
- Managed by Drizzle ORM
- Better-sqlite3 driver for synchronous access
- Schema versioned and migrated via `drizzle-kit`

### Watcher Process

**Chokidar**
- Monitors library folder for file events
- Filters for `.pdf` and `.epub` files only
- Uses `awaitWriteFinish` to handle large file uploads
- Runs as background process in production

**Event Handlers**
- `handleAdd` - New file detected, extract metadata, generate cover, insert DB record
- `handleChange` - Existing file modified, re-extract metadata, update DB record
- `handleDelete` - File removed, delete DB record and cover image

**Metadata Extractors**
- PDF: `pdf-parse` for text content, metadata extraction
- EPUB: `epub` npm package for parsing OPF manifest, extracting title/author
- Fallback to filename parsing if metadata unavailable

**Cover Generator**
- Primary: `pdftoppm` (poppler-utils) for high-quality PDF covers
- Fallback: `node-canvas` for synthetic cover rendering
- Generates 400x600px PNG thumbnails
- Handles both PDF and EPUB formats

## Data Flow

### Book Ingestion
1. User drops `book.pdf` into library folder
2. Chokidar detects file addition
3. Watcher reads file, computes SHA-256 hash
4. Check database for duplicate hash (skip if exists)
5. Extract metadata (title, author, page count)
6. Generate cover image from first page
7. Insert book record into database
8. Increment `library_version` in settings table
9. SSE endpoint detects version change within 2 seconds
10. All connected clients receive update event
11. Clients refresh their library view

### Reading Experience
1. User clicks book card in library
2. Navigate to `/read/[bookId]`
3. Fetch book metadata from API
4. Fetch reading progress for current user
5. Load appropriate reader (PDF.js or epub.js)
6. Stream book file from API
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
- Watcher runs in separate terminal
- SQLite database in `./data/library.db`
- Hot module replacement for fast iteration

### Production (Docker)
- Single container with Node.js 22
- Watcher runs as background process
- Next.js production server (standalone mode)
- Persistent Docker volume for `/app/data`
- Environment variables for configuration

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Next.js 16 |
| Styling | Tailwind CSS v4, shadcn/ui |
| Authentication | NextAuth.js v5 |
| Database | SQLite, better-sqlite3, Drizzle ORM |
| File Watching | chokidar |
| PDF Rendering | PDF.js (browser), pdf-parse (server) |
| EPUB Rendering | epub.js, react-reader |
| Cover Generation | poppler-utils (pdftoppm), node-canvas |
| Real-time | Server-Sent Events (SSE) |
| Deployment | Docker, Node.js 22 |
