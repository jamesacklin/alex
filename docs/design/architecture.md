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
    API -->|Query Books| DB
    API -->|Return JSON| UI

    %% Real-time Updates
    SSE -->|Subscribe| SSEEndpoint
    SSEEndpoint -->|Poll Every 2s| DB
    SSEEndpoint -->|library_version| SSE
    SSE -->|Trigger Refresh| UI

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
    API -->|/api/books/[id]/pdf| LibFolder
    PDF -->|Save Progress| API
    API -->|Update Progress| DB

    %% Reading Flow - EPUB
    EPUB -->|Request Book| API
    API -->|/api/books/[id]/book.epub| LibFolder
    EPUB -->|Save Location| API
    API -->|Update Progress| DB

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
    class Pages,API,Auth,SSEEndpoint server
    class LibFolder,Covers,DB,Users,Books,Progress,Collections,Settings storage
    class Chokidar,HandleAdd,HandleChange,HandleDelete,Extract,CoverGen process
```

## Component Descriptions

### Client Browser

**React UI**
- Next.js 19 client components
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
- Customizable font sizes (Times New Roman)

### Next.js App Router

**Pages & Layouts**
- `/library` - Main library grid view with search and filters
- `/read/[id]` - Book reader (PDF or EPUB)
- `/admin/users` - User management (admin only)
- `/login` - Authentication page

**API Routes**
- `GET /api/books` - List books with pagination, search, filters
- `GET /api/books/[id]` - Get book metadata
- `GET /api/books/[id]/pdf` - Serve PDF file
- `GET /api/books/[id]/book.epub` - Serve EPUB file
- `GET /api/books/[id]/cover` - Serve cover image
- `GET /api/books/[id]/progress` - Get reading progress
- `PUT /api/books/[id]/progress` - Update reading progress
- `GET /api/library/events` - SSE endpoint for real-time updates

**NextAuth.js**
- Credential-based authentication
- JWT sessions
- Role-based access control (admin/user)
- Bcrypt password hashing

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
2. Navigate to `/read/[id]`
3. Fetch book metadata from API
4. Fetch reading progress for current user
5. Load appropriate reader (PDF.js or epub.js)
6. Stream book file from API
7. Render at last saved position
8. On page/location change, debounce progress update
9. Calculate percentage complete
10. Update `reading_progress` table
11. Update book status (not_started → reading → completed)

### Real-time Updates
1. Client opens library page
2. Establish SSE connection to `/api/library/events`
3. Server sends initial "connected" message
4. Server polls `settings.library_version` every 2 seconds
5. When version changes, server pushes "library-update" event
6. Client receives event, refetches `/api/books`
7. UI updates with new/changed/deleted books
8. Connection maintained with keepalive pings

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
