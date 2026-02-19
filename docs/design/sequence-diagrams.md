# Sequence Diagrams

This document contains sequence diagrams illustrating key workflows in the Alex library management system.

## Real-time Library Update Flow

This diagram shows how the system detects and propagates library changes in near real-time using Server-Sent Events (SSE) and database-backed signaling.

```mermaid
sequenceDiagram
    participant User
    participant LibFolder as Library Folder
    participant Watcher as watcher-rs
    participant DB as SQLite DB
    participant SSE as SSE Endpoint
    participant Client as Browser Client
    participant API as API Routes

    Note over Client,SSE: Initial Connection
    Client->>SSE: Connect to /api/library/events
    SSE->>DB: getLibraryVersion()
    SSE-->>Client: Connected (version: 12345)

    loop Every 2 seconds
        SSE->>DB: Check library_version
    end

    Note over User,Watcher: User Adds Book
    User->>LibFolder: Drop book.pdf
    LibFolder-->>Watcher: File event (notify crate)
    Watcher->>Watcher: handle_add()
    Watcher->>LibFolder: Read file
    Watcher->>Watcher: Extract metadata (lopdf / quick-xml)
    Watcher->>Watcher: Generate cover (pdfium-render)
    Watcher->>DB: INSERT INTO books
    Watcher->>DB: incrementLibraryVersion()

    Note over SSE,Client: Update Detection
    SSE->>DB: getLibraryVersion()
    DB-->>SSE: New version: 12346
    SSE-->>Client: library-update event
    Client->>Client: Show "Library updated" banner
    User->>Client: Click "Refresh"
    Client->>API: GET /api/books
    API->>DB: SELECT books
    DB-->>API: Book data
    API-->>Client: JSON response
    Client->>API: GET /api/books/now-reading
    API->>DB: SELECT reading books ORDER BY last_read_at DESC
    API-->>Client: JSON response
    Client->>Client: Update Now Reading + All Books UI

    Note over User,Client: User Reads Book
    User->>Client: Click book
    Client->>API: GET /read/[bookId]
    API->>DB: Get book metadata
    Client->>API: GET /api/books/[id]/book.epub
    API->>LibFolder: Read epub file
    API-->>Client: Stream epub data
    Client->>Client: Render with epub.js

    Note over User,DB: Progress Tracking
    User->>Client: Navigate chapter
    Client->>API: PUT /api/books/[id]/progress
    API->>DB: UPDATE reading_progress
```

### Key Points

1. **SSE Connection**: Client establishes long-lived HTTP connection for push updates
2. **Version Polling**: Server polls database every 2 seconds (lightweight query)
3. **Cross-process Signaling**: Watcher and API share state via database
4. **Near Real-time**: Updates detected within 2 seconds, pushed immediately
5. **Efficient Updates**: Only refreshes when actual changes occur

---

## Book Ingestion Flow

Detailed flow showing how a new book is processed when added to the library folder.

```mermaid
sequenceDiagram
    participant FS as File System
    participant Notify as notify crate
    participant Handler as handle_add
    participant PDF as lopdf
    participant EPUB as quick-xml + zip
    participant CoverGen as Cover Generator
    participant DB as Database
    participant Pdfium as pdfium-render
    participant Glyph as ab_glyph + imageproc

    FS->>Notify: File added: book.pdf
    Notify->>Notify: Debounce (2s stability threshold)
    Notify->>Handler: dispatch add event

    Handler->>FS: Read file
    Handler->>Handler: Compute SHA-256 hash

    alt Check for duplicate
        Handler->>DB: SELECT WHERE fileHash = ?
        DB-->>Handler: Existing book found
        Handler->>Handler: Skip (duplicate)
    else New book
        DB-->>Handler: No match

        alt PDF file
            Handler->>PDF: Extract metadata (Info dictionary)
            PDF-->>Handler: { title, author, pageCount }
            Handler->>Pdfium: Render page 1 at 150 DPI
            alt Success
                Pdfium-->>Handler: JPEG buffer
            else Fallback
                Pdfium--xHandler: Error
                Handler->>Glyph: Render synthetic cover
                Glyph-->>Handler: JPEG buffer
            end
        else EPUB file
            Handler->>EPUB: Parse container.xml + OPF
            EPUB-->>Handler: { title, author, description }
            Handler->>EPUB: Extract cover image from ZIP
            EPUB-->>Handler: Cover buffer (re-encoded to JPEG)
        end

        Handler->>FS: Write cover to data/covers/
        Handler->>DB: INSERT INTO books
        Handler->>DB: incrementLibraryVersion()
        DB-->>Handler: Success

        Handler->>Handler: Log success
    end
```

### Processing Steps

1. **File Detection**: `notify` crate watches library folder
2. **Write Stabilization**: Custom debounce waits until file size is stable for 2 seconds
3. **Duplicate Check**: SHA-256 hash (via `sha2` crate) prevents duplicate entries
4. **Metadata Extraction**: `lopdf` for PDFs, `quick-xml` + `zip` for EPUBs
5. **Cover Generation**: `pdfium-render` for PDFs, ZIP extraction for EPUBs, synthetic fallback via `ab_glyph`
6. **Database Insert**: Atomic insert via `rusqlite`
7. **Version Bump**: Triggers real-time update to all clients

---

## User Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant LoginPage as /login
    participant Auth as NextAuth.js
    participant DB as Database
    participant Session as JWT Session

    User->>Browser: Navigate to /library
    Browser->>Auth: Check session
    Auth->>Session: Verify JWT token
    Session-->>Auth: No valid session
    Auth->>Browser: Redirect to /login

    User->>LoginPage: Enter email & password
    LoginPage->>Auth: POST /api/auth/callback/credentials
    Auth->>DB: SELECT user WHERE email = ?
    DB-->>Auth: User record with passwordHash

    alt Valid credentials
        Auth->>Auth: bcrypt.compare(password, hash)
        Auth->>Session: Sign JWT token
        Session-->>Auth: Token created
        Auth-->>Browser: Set session cookie
        Browser->>Browser: Redirect to /library
    else Invalid credentials
        Auth-->>LoginPage: Error: Invalid credentials
        LoginPage-->>User: Show error message
    end

    Note over Browser,Auth: Subsequent Requests
    Browser->>API: GET /api/books
    API->>Auth: Verify session middleware
    Auth->>Session: Decode JWT token
    Session-->>Auth: User { id, email, role }
    Auth-->>API: Authorized
    API->>DB: Query books
    DB-->>API: Book data
    API-->>Browser: JSON response
```

### Authentication Flow

1. **Session Check**: All protected routes verify JWT session
2. **Redirect**: Unauthenticated users sent to `/login`
3. **Credential Validation**: Email lookup + bcrypt password comparison
4. **JWT Creation**: Stateless session token (no database storage)
5. **Cookie Storage**: HttpOnly, secure session cookie
6. **Role-based Access**: Admin vs. user permissions enforced in middleware

---

## PDF Reading Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as PDF Reader UI
    participant Worker as PDF.js Worker
    participant API
    participant FS as File System
    participant DB as Database

    User->>UI: Click "Open Book"
    UI->>API: GET /api/books/[id]
    API->>DB: SELECT book metadata
    DB-->>API: Book data
    API-->>UI: { id, title, author, pageCount }

    UI->>API: GET /api/books/[id]/progress
    API->>DB: SELECT reading_progress
    DB-->>API: { currentPage: 42, percentComplete: 35 }
    API-->>UI: Progress data

    UI->>Worker: Initialize PDF.js
    UI->>API: GET /api/books/[id]/file
    API->>FS: Read PDF file
    FS-->>API: File stream
    API-->>Worker: PDF binary data

    Worker->>Worker: Parse PDF structure
    Worker->>Worker: Render page 42
    Worker-->>UI: Canvas bitmap
    UI->>UI: Display page

    loop User navigates
        User->>UI: Click "Next Page"
        UI->>Worker: Render page 43
        Worker-->>UI: Canvas bitmap
        UI->>UI: Display page

        Note over UI,DB: Debounced progress save
        UI->>API: PUT /api/books/[id]/progress
        API->>DB: UPDATE reading_progress
        API->>DB: UPDATE status if needed
        DB-->>API: Success
    end
```

### PDF Reading Features

1. **Metadata Loading**: Title, author, page count fetched first
2. **Progress Restoration**: User returns to last read page
3. **Web Worker**: PDF.js runs in background thread (non-blocking)
4. **Streaming**: Large PDFs streamed incrementally
5. **Debounced Saves**: Progress updates batched to reduce writes
6. **Status Tracking**: Automatic status updates (not_started → reading → completed)

---

## EPUB Reading Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as EPUB Reader UI
    participant ReactReader as react-reader
    participant Rendition as epub.js Rendition
    participant API
    participant FS as File System
    participant DB as Database

    User->>UI: Click "Open Book"
    UI->>API: GET /api/books/[id]
    API->>DB: SELECT book metadata
    DB-->>API: Book data
    API-->>UI: { id, title, author, fileType: 'epub' }

    UI->>API: GET /api/books/[id]/progress
    API->>DB: SELECT reading_progress
    DB-->>API: { epubLocation: 'epubcfi(...)', percentComplete: 45 }
    API-->>UI: Progress data

    UI->>API: GET /api/books/[id]/book.epub
    API->>FS: Read EPUB file
    FS-->>API: EPUB binary
    API-->>UI: ArrayBuffer

    UI->>ReactReader: Initialize with ArrayBuffer
    ReactReader->>Rendition: Create rendition
    Rendition->>Rendition: Parse EPUB structure
    Rendition->>Rendition: Extract table of contents
    Rendition-->>UI: TOC data

    Rendition->>Rendition: Navigate to epubcfi(...)
    Rendition->>Rendition: Apply font (IBM Plex Serif)
    Rendition->>Rendition: Apply font size
    Rendition->>Rendition: Constrain content to 80ch
    Rendition->>Rendition: Render HTML content
    Rendition-->>UI: Rendered page

    loop User reads
        User->>UI: Click "Next Chapter"
        UI->>Rendition: Navigate to chapter
        Rendition-->>UI: New content

        Rendition->>Rendition: Calculate percentage
        Rendition-->>UI: Location change event

        Note over UI,DB: Save progress
        UI->>API: PUT /api/books/[id]/progress
        API->>DB: UPDATE reading_progress<br/>SET epubLocation, percentComplete
        DB-->>API: Success
    end
```

### EPUB Reading Features

1. **ArrayBuffer Loading**: Entire EPUB loaded into memory (fast navigation)
2. **CFI Locations**: ePub Canonical Fragment Identifiers for precise positioning
3. **TOC Extraction**: Table of contents parsed from EPUB manifest
4. **Typography Control**: Font size customization (IBM Plex Serif + 80ch column)
5. **Progress Meter**: Header displays precise percentage while reading
6. **Scroll Restore**: Saved scroll fraction is restored when viewport dimensions match
7. **Percentage Calculation**: epub.js generates location spine for progress tracking

---

## Search and Filter Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Library UI
    participant Debounce as Debounce Timer
    participant Router as Next Router
    participant API
    participant DB as Database

    User->>UI: Type "tolkien" in search
    UI->>Debounce: Start 300ms timer

    User->>UI: Continue typing...
    UI->>Debounce: Reset timer

    Note over Debounce: 300ms passes without input
    Debounce->>Router: Push ?q=tolkien
    Router->>UI: URL updated
    UI->>API: GET /api/books?q=tolkien

    API->>DB: SELECT * FROM books<br/>WHERE title LIKE '%tolkien%'<br/>OR author LIKE '%tolkien%'
    DB-->>API: Matching books
    API-->>UI: { books: [...], total: 3 }

    UI->>UI: Render results

    User->>UI: Select filter "Status: Reading"
    UI->>Router: Push ?q=tolkien&status=reading
    Router->>UI: URL updated
    UI->>API: GET /api/books?q=tolkien&status=reading

    API->>DB: SELECT books b<br/>JOIN reading_progress rp<br/>WHERE (title LIKE '%tolkien%' OR author LIKE '%tolkien%')<br/>AND rp.status = 'reading'
    DB-->>API: Filtered books
    API-->>UI: { books: [...], total: 1 }

    UI->>UI: Render filtered results
```

### Search Features

1. **Debounced Input**: 300ms delay prevents excessive API calls
2. **URL State**: Search and filters stored in query parameters
3. **Full-text Search**: Searches title and author fields
4. **Combined Filters**: Multiple filters applied simultaneously
5. **Pagination**: Results paginated (24 per page)
6. **User-specific**: Progress filters join with current user's reading data

---

## Now Reading Sections Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Library / Collection UI
    participant API
    participant DB as Database

    User->>UI: Open library or collection page
    UI->>API: GET /api/books/now-reading (or /api/collections/[id]/now-reading)
    API->>DB: JOIN books + reading_progress
    API->>DB: WHERE status='reading' AND user_id=?
    API->>DB: ORDER BY last_read_at DESC
    DB-->>API: Now Reading books
    API-->>UI: { books: [...] }

    UI->>API: GET paginated all-books endpoint
    API->>DB: SELECT paginated books (+ progress join)
    DB-->>API: { books, total, hasMore }
    API-->>UI: JSON response

    UI->>UI: Exclude Now Reading IDs from All Books grid
    UI->>UI: Render separate sections without duplicates
```

### Key Points

1. **Dedicated endpoints**: Now Reading data is fetched independently from the main paginated list.
2. **Stable ordering**: Uses `reading_progress.last_read_at DESC` for recency.
3. **Duplicate prevention**: Client removes Now Reading IDs from All Books before rendering.
4. **Infinite-scroll safety**: Section split avoids repeated loads caused by duplicate results.

---

## Cover Generation Flow

```mermaid
sequenceDiagram
    participant Handler as handle_add
    participant FS as File System
    participant Pdfium as pdfium-render
    participant Glyph as ab_glyph + imageproc

    alt PDF Cover
        Handler->>Pdfium: Render page 1 at 150 DPI
        alt Success
            Pdfium-->>Handler: JPEG buffer
        else pdfium render failed
            Pdfium--xHandler: Error
            Handler->>Glyph: Create 400x600 canvas
            Glyph->>Glyph: Fill gradient background
            Glyph->>Glyph: Draw title text
            Glyph->>Glyph: Draw author text
            Glyph-->>Handler: Synthetic JPEG buffer
        end
    else EPUB Cover
        Handler->>Handler: Parse container.xml + OPF for cover ref
        alt Cover in archive
            Handler->>FS: Extract cover image from EPUB ZIP
            FS-->>Handler: Image buffer (re-encoded to JPEG)
        else No cover found
            Handler->>Glyph: Create synthetic cover
            Glyph-->>Handler: JPEG buffer
        end
    end

    Handler->>FS: Write to data/covers/[uuid].jpg
    FS-->>Handler: Success
```

## Public Collection Sharing Flow

This diagram shows how a collection owner enables sharing and how a public viewer accesses the shared collection.

```mermaid
sequenceDiagram
    participant Owner
    participant OwnerUI as Owner's Browser
    participant API as API Routes
    participant DB as Database
    participant Viewer
    participant ViewerUI as Viewer's Browser
    participant LS as localStorage

    Note over Owner,DB: Owner Enables Sharing
    Owner->>OwnerUI: Click "Share" on collection
    OwnerUI->>API: POST /api/collections/[id]/share
    API->>DB: Verify ownership (userId match)
    API->>API: crypto.randomUUID()
    API->>DB: UPDATE collections SET share_token, shared_at
    DB-->>API: Success
    API-->>OwnerUI: { shareToken, shareUrl }
    OwnerUI->>OwnerUI: Display share URL with copy button
    Owner->>Owner: Copy link, send to viewer

    Note over Viewer,LS: Public Viewer Accesses Collection
    Viewer->>ViewerUI: Open /shared/[token]
    ViewerUI->>API: GET /api/shared/[token]
    API->>DB: SELECT FROM collections WHERE share_token = ?
    DB-->>API: Collection data
    API->>DB: SELECT books via collection_books JOIN
    DB-->>API: Book list
    API-->>ViewerUI: { collection, books, pagination }
    ViewerUI->>ViewerUI: Render collection grid

    loop Cover images
        ViewerUI->>API: GET /api/shared/[token]/covers/[bookId]
        API->>DB: Verify book in collection
        API-->>ViewerUI: Cover image (or SVG placeholder)
    end

    Note over Viewer,LS: Public Viewer Reads a Book
    Viewer->>ViewerUI: Click book card
    ViewerUI->>ViewerUI: Navigate to /shared/[token]/read/[bookId]
    ViewerUI->>API: GET /api/shared/[token]/books/[bookId]/file
    API->>DB: Verify token + book membership
    API-->>ViewerUI: Stream book file

    ViewerUI->>LS: Load saved progress (if any)
    LS-->>ViewerUI: { currentPage } or null
    ViewerUI->>ViewerUI: Render PdfReader or EpubReader

    loop Viewer navigates pages
        Viewer->>ViewerUI: Turn page
        ViewerUI->>LS: Save progress
        Note over LS: Key: shared-progress:[token]:[bookId]
    end

    Note over Owner,DB: Owner Revokes Sharing
    Owner->>OwnerUI: Click "Stop Sharing"
    OwnerUI->>API: DELETE /api/collections/[id]/share
    API->>DB: UPDATE collections SET share_token = NULL
    DB-->>API: Success
    API-->>OwnerUI: { success: true }

    Note over Viewer,API: Link No Longer Works
    Viewer->>ViewerUI: Open /shared/[token]
    ViewerUI->>API: GET /api/shared/[token]
    API->>DB: SELECT WHERE share_token = ?
    DB-->>API: No match
    API-->>ViewerUI: 404 Not Found
    ViewerUI->>ViewerUI: Show "Collection not found" page
```

### Key Points

1. **Token generation**: `crypto.randomUUID()` produces 122-bit random tokens
2. **Ownership check**: Only the collection owner can enable/disable sharing
3. **Scoped access**: Every public endpoint validates that the book belongs to the shared collection
4. **No server state for viewers**: Reading progress stored in browser `localStorage`, not the database
5. **Instant revocation**: Setting `share_token = NULL` immediately invalidates all existing links
6. **Reader reuse**: Public reader uses the same `PdfReader` and `EpubReader` components as authenticated users

---

### Cover Generation Strategy

1. **Primary (PDFs)**: Render page 1 at 150 DPI via `pdfium-render` with statically linked PDFium
2. **Fallback (PDFs)**: Synthetic gradient cover with title/author via `ab_glyph` + `imageproc`
3. **Primary (EPUBs)**: Extract embedded cover image from the ZIP archive (re-encoded to JPEG if needed)
4. **Fallback (EPUBs)**: Generate synthetic cover
5. **Storage**: Covers stored as JPEG with UUID filename for uniqueness

---

## Electron Desktop App Flow

This diagram shows how the Electron desktop app initializes and manages the embedded Next.js server.

```mermaid
sequenceDiagram
    participant User
    participant Electron as Electron Main Process
    participant Next as Next.js Server
    participant Watcher as File Watcher
    participant DB as SQLite Database
    participant Browser as BrowserWindow

    User->>Electron: Launch app
    Electron->>Electron: Check for existing database

    alt First run (no database)
        Electron->>Browser: Show /setup route
        User->>Browser: Create admin account
        Browser->>Next: POST admin credentials
        Next->>DB: Insert admin user
        DB-->>Next: Success
        Next-->>Browser: Redirect to /library
    else Existing database
        Electron->>Next: Start embedded server on :3210
        Next->>DB: Run db:push (idempotent)
        Next->>DB: Run db:seed (idempotent)
        Next->>Watcher: Start file watcher
        Watcher->>DB: getLibraryPath()
        Watcher->>Watcher: Monitor library folder
        Next-->>Electron: Server ready
        Electron->>Browser: Create window → http://localhost:3210
        Browser->>Next: GET /library
        Next->>DB: Fetch books
        DB-->>Next: Book data
        Next-->>Browser: Render library
    end

    Note over User,DB: User adds book to library
    User->>Watcher: Drop book.pdf in library folder
    Watcher->>Watcher: Process file (same as web)
    Watcher->>DB: Insert book + increment version
    DB->>Next: SSE detects update
    Next-->>Browser: Push library-update event
    Browser->>Browser: Show refresh banner

    Note over Electron,Browser: App lifecycle
    User->>Browser: Close window
    Browser->>Electron: window-all-closed event
    Electron->>Watcher: Graceful shutdown
    Electron->>Next: Stop server
    Electron->>Electron: Exit app
```

### Electron Architecture Notes

1. **Embedded Server**: Next.js runs as a child process managed by Electron
2. **Port 3210**: Fixed port for internal communication (no conflicts - local only)
3. **Single Instance**: Electron ensures only one app instance runs at a time
4. **Data Location**: SQLite database and library stored in platform-specific app data:
   - macOS: `~/Library/Application Support/alex`
   - Windows: `%APPDATA%/alex`
   - Linux: `~/.config/alex`
5. **Rust Binary**: `watcher-rs` bundled at `process.resourcesPath/watcher-rs/` with PDFium library; no native Node modules required
6. **Auto-updates**: Electron-builder provides update checking and installation
7. **First-run Setup**: Setup route creates initial admin account before library access
