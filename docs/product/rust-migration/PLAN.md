# Rust Migration Plan

This document captures the rationale, scope, and phased plan for migrating Alex's back-end processes from TypeScript/Electron to Rust/Tauri.

## Motivation

- **Binary size**: Electron bundles Chromium (~150MB). Tauri uses the system webview (~10MB).
- **Memory usage**: Single Rust process with threads vs. three spawned Node.js child processes.
- **Startup time**: No Chromium cold start.
- **Native module pain**: `better-sqlite3` requires ABI-matched rebuilds for each Electron version. Rust's `rusqlite` links statically.
- **Process model**: Electron orchestrates a Next.js server, a file watcher, and a renderer as separate processes. Tauri consolidates the backend into a single binary with threads.

## Architecture: Current vs. Target

### Current (Electron + TypeScript)

```
Electron main process
  ├── spawns Next.js standalone server (port 3210)
  ├── spawns file watcher (chokidar, separate Node.js process)
  └── BrowserWindow (Chromium renderer)
        └── loads http://localhost:3210

Shared state: SQLite file (better-sqlite3 + Drizzle ORM)
IPC: Electron preload bridge (ipcMain.handle / window.electronAPI)
Inter-process signaling: DB polling (settings.library_version) + SSE
```

### Target (Tauri + Rust)

```
Tauri binary (single process)
  ├── Rust thread: file watcher (notify crate)
  ├── Rust thread: HTTP API server (axum) — or Tauri commands replacing API routes
  ├── Rust: SQLite via rusqlite (shared connection pool)
  └── System webview
        └── loads bundled SPA (Vite + React)

IPC: Tauri commands (invoke) + Tauri events (emit/listen)
No child processes. No Node.js runtime.
```

## Frontend Decision

Convert from Next.js (SSR) to a client-rendered SPA served from the Tauri bundle. SSR is barely used in the current app. The SPA would be built with Vite + React and bundled as static assets.

## Component-by-Component Migration

### 1. File Watcher

**Current**: `chokidar` watching `$LIBRARY_PATH` for `.pdf` and `.epub` files. On add/change: SHA-256 hash, deduplicate, extract metadata + cover, insert into SQLite. On delete: remove DB row + cover file. On ready: orphan cleanup.

**Target**: `notify` crate on a dedicated Rust thread. Manual debouncing to replicate `awaitWriteFinish` (2s stability threshold). SHA-256 via `sha2` crate. Direct `rusqlite` writes. Signal frontend via Tauri events instead of DB polling + SSE.

**Key crates**: `notify`, `sha2`, `rusqlite`, `uuid`

**Effort**: 2-3 weeks

### 2. EPUB Metadata Extraction

**Current**: `epub2` npm package opens the EPUB (ZIP), reads OPF metadata (title, creator, description), extracts cover image by ID. ~30 lines of code.

**Target**: `zip` crate to open archive, `quick-xml` to parse `content.opf`, extract `<dc:title>`, `<dc:creator>`, `<dc:description>`, and cover image reference. Write cover bytes to disk.

**Key crates**: `zip`, `quick-xml`, `image`

**Effort**: 2-3 days

### 3. PDF Cover Rendering + Metadata

**Current**: `pdfjs-dist` renders page 1 at 150 DPI via `@napi-rs/canvas`. `pdf-parse` extracts title, author, page count.

**Target**: `pdfium-render` with statically linked PDFium binaries (from `pdfium-binaries`). Render page 1 to pixel buffer, encode as JPEG via `image` crate. `lopdf` for metadata extraction.

**Why pdfium over poppler**: Pre-built static libraries available for all platforms. No system dependency. No sidecar. Self-contained in the binary (~15MB). `pdf2image` (poppler wrapper) shells out to `pdftoppm` and would require bundling poppler CLI tools or painful static linking of poppler's C++ dependency tree.

**Key crates**: `pdfium-render`, `lopdf`, `image`

**Effort**: 2-3 weeks

### 4. API Server

**Current**: ~20 Next.js App Router route handlers covering books CRUD, collections, reading progress, file streaming (HTTP 206), SSE events, shared collection access, user management. NextAuth JWT sessions with bcrypt passwords.

**Target**: Two possible approaches:

- **Option A (axum HTTP server)**: Reimplement routes as an axum server running on a Rust thread. Frontend fetches from localhost. Closest to current architecture, easiest migration path for the frontend.
- **Option B (Tauri commands)**: Replace API routes with `#[tauri::command]` functions. Frontend calls `invoke()` instead of `fetch()`. Tighter integration, no HTTP overhead, but requires reworking all frontend data fetching.

Option A is lower risk for initial migration; Option B is cleaner long-term.

**Key crates**: `axum`, `tower`, `jsonwebtoken`, `bcrypt`, `tokio`

**Effort**: 3-4 weeks

### 5. Auth System

**Current**: NextAuth credentials provider, bcrypt password hashing, JWT sessions, `NEXTAUTH_SECRET` generated on first run.

**Target**: `jsonwebtoken` + `bcrypt` crates. Custom middleware for JWT validation. Session stored as an HTTP-only cookie (axum) or managed in Tauri state (commands approach).

**Effort**: 1 week

### 6. Database Layer

**Current**: SQLite via `better-sqlite3` + Drizzle ORM. 5 tables: `users`, `books`, `reading_progress`, `collections`, `collection_books`, `settings`. WAL mode.

**Target**: `rusqlite` (synchronous, matches current usage) or `sqlx` (async). Schema migrations via `refinery` or `sqlx migrate`. Same 5-table schema.

**Effort**: 1 week

### 7. Tauri Shell (replacing Electron)

**Current**: BrowserWindow, system tray (show/quit/change library), file dialog for library selection, IPC channels for library management, JSON config store, window bounds persistence.

**Target**: Tauri webview, `tauri::SystemTray`, `tauri::api::dialog`, `#[tauri::command]` handlers, `serde_json` config file, Tauri window state plugin.

**Effort**: 1-2 weeks

### 8. SPA Conversion (Next.js to Vite)

**Current**: Next.js App Router with SSR pages, API route data fetching, `next/dynamic` imports.

**Target**: Vite + React Router (or TanStack Router). Convert `page.tsx` files to route components. Replace `fetch('/api/...')` calls with either `fetch('http://localhost:PORT/...')` (Option A) or `invoke('command_name', ...)` (Option B).

**Effort**: 1-2 weeks

### 9. Build and CI

**Current**: `electron-builder` producing .zip (macOS), NSIS (Windows), AppImage/.deb (Linux). GitHub Actions workflow.

**Target**: `tauri build` producing .dmg/.app (macOS), .msi (Windows), .deb/.AppImage (Linux). Update CI to install Rust toolchain + platform dependencies.

**Effort**: 1 week

## Phased Approach

### Phase 1: Rust Watcher (standalone, no Tauri yet)

Build the file watcher as a standalone Rust binary that watches a directory, extracts metadata, generates covers, and writes to SQLite. Test it against the existing database schema. This can run alongside the current Electron app as a drop-in replacement for the TypeScript watcher.

Includes: watcher, EPUB extractor, PDF extractor (pdfium), SQLite writes.

### Phase 2: Tauri Shell + SPA

Set up the Tauri project. Convert the Next.js frontend to a Vite SPA. Wire up Tauri commands for library path selection, rescanning, and app settings. The API server can initially be the existing Next.js server running as a sidecar, then replaced incrementally.

### Phase 3: Rust API Server

Reimplement the API routes in Rust (axum or Tauri commands). Migrate auth. Remove the Next.js server dependency entirely.

### Phase 4: Polish and Packaging

Cross-platform builds, CI pipeline, auto-update (Tauri has built-in updater support), testing, and release.

## Risk Register

| Risk | Mitigation |
|------|------------|
| PDFium static lib adds ~15MB per platform | Acceptable tradeoff vs. system dependency; still far smaller than Electron |
| Rust EPUB ecosystem is thin | Our needs are minimal (ZIP + XML parse); custom code is manageable |
| System webview rendering differences (WebKit on macOS, WebView2 on Windows) | Test epub.js and react-pdf in both engines early |
| Loss of development velocity during migration | Phase 1 is additive (runs alongside current app); no big-bang rewrite |
| `notify` crate lacks `awaitWriteFinish` equivalent | Implement debounce with `tokio::time::sleep` + file size polling |

## Estimated Total Effort

10-16 weeks for a single developer, depending on experience with Rust and the API server approach chosen. Phase 1 (watcher) is the natural starting point and can be validated independently.
