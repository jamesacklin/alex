# Book Library App (Plex-like for PDFs and ePubs)

## Overview

Build a self-hosted media server for PDF and ePub files with automatic library management, built-in readers, and admin-managed user authentication.

## Tech Stack

- **Framework**: Next.js 15 (App Router) - unified frontend/backend
- **Database**: SQLite with Drizzle ORM - zero-config, type-safe
- **Auth**: NextAuth.js with Credentials provider - admin-managed accounts
- **File Watching**: chokidar - directory monitoring for library updates
- **PDF Viewer**: react-pdf (PDF.js wrapper)
- **ePub Viewer**: react-reader (epub.js wrapper)
- **UI Components**: shadcn/ui (Radix UI primitives + Tailwind CSS)

## Project Structure

```
alex/
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── library/page.tsx
│   │   │   ├── read/[bookId]/page.tsx
│   │   │   ├── collections/page.tsx
│   │   │   └── admin/users/page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── books/[id]/route.ts
│   │       ├── books/[id]/file/route.ts
│   │       ├── books/[id]/progress/route.ts
│   │       ├── collections/route.ts
│   │       ├── users/route.ts
│   │       └── library/scan/route.ts
│   ├── components/
│   │   ├── readers/PdfReader.tsx
│   │   ├── readers/EpubReader.tsx
│   │   └── library/BookGrid.tsx
│   └── lib/
│       ├── db/schema.ts
│       ├── auth/config.ts
│       └── metadata/pdf.ts, epub.ts
├── watcher/                    # Separate file watcher process
│   ├── index.ts
│   └── processor.ts
└── data/
    ├── library.db
    └── covers/
```

## Database Schema

### Tables

1. **users** - id, email, passwordHash, displayName, role (admin/user)
2. **books** - id, title, author, filePath, fileType (pdf/epub), fileHash, coverPath, pageCount
3. **reading_progress** - userId, bookId, currentPage/epubLocation, percentComplete, status
4. **collections** - id, userId, name
5. **collection_books** - collectionId, bookId

## Implementation Phases

### Phase 1: Project Setup

- Initialize Next.js 15 with TypeScript
- Initialize shadcn/ui (configures Tailwind CSS automatically)
- Add core shadcn components: Button, Card, Input, Dialog, Table, DropdownMenu, Avatar, Badge, Skeleton
- Set up Drizzle ORM with SQLite (better-sqlite3)
- Create database schema and migrations

### Phase 2: Authentication

- Configure NextAuth.js with Credentials provider
- Create login page
- Implement role-based middleware (admin vs user)
- Build first-run admin setup flow
- Build admin user management page

### Phase 3: File Watcher Service

- Create separate Node.js watcher process using chokidar
- Implement PDF metadata extraction (pdf-parse)
- Implement ePub metadata extraction (epub2)
- Extract and store cover images
- Handle file add/change/delete events
- File hashing for change detection

### Phase 4: Library UI

- Books API endpoints (list, get, search)
- BookGrid component with cover display
- Search, filter, and sort functionality
- Responsive layout

### Phase 5: PDF Reader

- Integrate react-pdf
- Page navigation (buttons, keyboard, jump-to-page)
- Zoom controls
- Text search
- Progress saving (debounced)

### Phase 6: ePub Reader

- Integrate react-reader
- Chapter navigation with TOC
- Font size and theme controls
- Progress tracking via CFI locations

### Phase 7: Collections & Progress

- Collections CRUD API and UI
- Add/remove books from collections
- Reading progress display on library page
- "Continue Reading" section

### Phase 8: Polish

- Loading states and skeletons
- Error handling
- Keyboard shortcuts
- Mobile responsiveness

## Key API Endpoints

| Method | Endpoint                 | Description              |
| ------ | ------------------------ | ------------------------ |
| GET    | /api/books               | List books with filters  |
| GET    | /api/books/[id]/file     | Stream book file         |
| PUT    | /api/books/[id]/progress | Update reading progress  |
| POST   | /api/users               | Create user (admin only) |
| POST   | /api/library/scan        | Trigger manual rescan    |

## Verification Plan

1. **Auth**: Login as admin, create a user, login as that user
2. **Library**: Add PDFs/ePubs to watched directory, verify they appear
3. **PDF Reader**: Open PDF, navigate pages, close, reopen to verify progress saved
4. **ePub Reader**: Open ePub, change chapters, verify progress persists
5. **Collections**: Create collection, add books, verify display
6. **File Watcher**: Delete a file from directory, verify removed from library
