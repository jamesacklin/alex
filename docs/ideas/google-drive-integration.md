# Google Drive Integration Plan

## Overview

Allow users to connect their Google Drive account to Alex, browse/monitor their Drive for PDF and EPUB files, and read them through the app. Files are downloaded on demand and cached locally; Drive is periodically polled for changes so new books appear automatically.

---

## Architecture Summary

Alex currently works like this:
- A **Rust file watcher** (`watcher-rs`) monitors a local `LIBRARY_PATH` directory for `.pdf` and `.epub` files, extracts metadata/covers, and inserts rows into a **SQLite** database via the `books` table.
- The **Next.js frontend** queries the `books` table and serves files from local disk paths (`/api/books/[id]/file`).
- **Auth** uses NextAuth v5 with a Credentials provider (email/password), JWT sessions, stored in a `users` table.

The Google Drive integration adds a parallel ingestion path: instead of watching a local directory, a server-side poller queries the Google Drive API for PDFs/EPUBs, downloads them into the local library, and lets the existing watcher pipeline handle indexing. The user authenticates via Google OAuth to grant Drive read access.

---

## Phase 1: Google OAuth & Token Storage

### 1.1 Google Cloud Console Setup (Manual / Docs)

- Create a Google Cloud project (or reuse an existing one).
- Enable the **Google Drive API**.
- Create **OAuth 2.0 credentials** (Web application type).
  - Authorized redirect URI: `{NEXTAUTH_URL}/api/auth/callback/google-drive`
- Required scopes:
  - `https://www.googleapis.com/auth/drive.readonly` — read-only access to list and download files.
- Add env vars to `.env.example` and `.env`:
  ```
  GOOGLE_DRIVE_CLIENT_ID=
  GOOGLE_DRIVE_CLIENT_SECRET=
  ```

### 1.2 New Database Table: `google_drive_connections`

This is a **per-user** OAuth connection, separate from the app login. A user logs into Alex with email/password, then optionally links their Google account.

```sql
CREATE TABLE google_drive_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  google_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  drive_folder_id TEXT,          -- optional: restrict sync to a specific folder
  last_sync_at INTEGER,
  sync_enabled INTEGER DEFAULT 1 NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

A migration file (`0001_google_drive.sql`) will be added alongside the existing `0000_wide_expediter.sql`, and `db-push.js` updated to apply it.

### 1.3 OAuth Flow (Custom, Not NextAuth Provider)

Since the app's login is Credentials-based and we don't want to change that, Google OAuth is handled as a **separate "Connect your Drive"** flow:

1. **`GET /api/google-drive/auth`** — Generates a Google OAuth authorization URL with `state` containing the user's session ID (CSRF-protected) and redirects.
2. **Google redirects back to `GET /api/google-drive/callback`** — Exchanges the authorization code for access + refresh tokens via `googleapis` npm package, stores them in `google_drive_connections`, and redirects to the settings page with a success toast.
3. **`DELETE /api/google-drive/auth`** — Disconnects: revokes the Google token and deletes the row.

### 1.4 Token Refresh Utility

Create `src/lib/google-drive/auth.ts`:
- `getValidAccessToken(userId)` — reads the connection row, checks `token_expires_at`, refreshes via Google's token endpoint if expired, updates the DB row, returns a valid access token.

### 1.5 New Dependencies

```
pnpm add googleapis
```

The `googleapis` package provides typed clients for Drive API v3 and handles OAuth2 token management.

---

## Phase 2: Google Drive File Browser & Sync Configuration

### 2.1 Drive Browser API Routes

- **`GET /api/google-drive/files`** — Lists PDF/EPUB files from the user's Drive.
  - Query params: `folderId` (optional, defaults to root), `pageToken` (pagination).
  - Uses Drive API `files.list` with query: `(mimeType='application/pdf' or mimeType='application/epub+zip') and trashed=false`.
  - Returns: `{ files: [{ id, name, mimeType, modifiedTime, size, parents }], nextPageToken }`.

- **`GET /api/google-drive/folders`** — Lists folders for the folder picker.
  - Query: `mimeType='application/vnd.google-apps.folder' and trashed=false`.
  - Supports `folderId` param for drilling into subfolders.

- **`PUT /api/google-drive/settings`** — Saves sync preferences.
  - Body: `{ folderId?: string, syncEnabled: boolean }`.
  - Updates `google_drive_connections.drive_folder_id` and `sync_enabled`.

- **`GET /api/google-drive/status`** — Returns connection status for the current user.
  - Returns: `{ connected: boolean, googleEmail?, lastSyncAt?, syncEnabled?, folderId?, folderName? }`.

### 2.2 Drive Browser UI

Add a new **settings page section** or a dedicated page under the admin/dashboard area:

**Location:** `src/app/(dashboard)/admin/integrations/page.tsx`

Components:
- **`GoogleDriveCard`** — Shows connection status. "Connect Google Drive" button triggers the OAuth flow. When connected, shows the linked Google email and a "Disconnect" button.
- **`DriveFolderPicker`** — A tree/breadcrumb folder browser that lets the user choose a specific folder to monitor (or "All of My Drive"). Calls `/api/google-drive/folders`.
- **`DriveSyncSettings`** — Toggle for auto-sync, display of last sync time, manual "Sync Now" button.

Add a nav link for "Integrations" in the admin sidebar layout (`src/app/(dashboard)/admin/layout.tsx`).

---

## Phase 3: File Sync Engine

### 3.1 Sync Logic: `src/lib/google-drive/sync.ts`

The sync process:

1. **List remote files** — Query Drive API for all PDF/EPUB files (within the configured folder, if set). Use `fields` parameter to get `id, name, mimeType, md5Checksum, modifiedTime, size`.
2. **Compare with local state** — New table `google_drive_files` tracks which Drive files have been synced:
   ```sql
   CREATE TABLE google_drive_files (
     drive_file_id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     book_id TEXT,                    -- FK to books.id once downloaded
     drive_name TEXT NOT NULL,
     drive_md5 TEXT,
     drive_modified_at TEXT NOT NULL,
     local_file_path TEXT,
     sync_status TEXT DEFAULT 'pending' NOT NULL, -- pending | downloading | synced | error
     error_message TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
     FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
   );
   ```
3. **Download new/changed files** — For files not yet synced (or where `drive_md5` changed):
   - Download via Drive API `files.get` with `alt=media`.
   - Save to `LIBRARY_PATH/google-drive/{driveFileId}/{filename}`.
   - The existing `watcher-rs` will detect the new file, extract metadata/cover, and insert it into `books`.
   - After the watcher processes it, update `google_drive_files.book_id` by matching on `file_path`.
4. **Handle deletions** — Files removed from Drive: optionally remove the local copy and let the watcher handle the book deletion. This should be a user preference (keep local copy vs. mirror Drive deletions).

### 3.2 Sync Trigger Mechanisms

Three ways sync can happen:

1. **Manual** — "Sync Now" button calls `POST /api/google-drive/sync`. Runs sync inline and returns results.
2. **Periodic polling** — A lightweight background job. Two options depending on deployment:
   - **Web/Docker deployment:** A Next.js API route `GET /api/google-drive/sync/poll` called by an external cron (e.g., a cron container, or a `setInterval` in the SSE events endpoint). Recommended interval: every 15 minutes.
   - **Electron deployment:** The Electron main process can schedule sync via `setInterval` calling the same API route.
3. **On app load** — When the dashboard loads, if `lastSyncAt` is older than 15 minutes, trigger a background sync.

### 3.3 Sync API Route

**`POST /api/google-drive/sync`**
- Auth-protected.
- Calls the sync engine for the current user.
- Returns: `{ added: number, updated: number, removed: number, errors: string[] }`.

---

## Phase 4: Reading Google Drive Files

### 4.1 No Reader Changes Needed

Once a Drive file is downloaded to `LIBRARY_PATH/google-drive/...`, the existing watcher indexes it into the `books` table with a `file_path`. The existing `/api/books/[id]/file` route serves files by reading from `file_path`, and the EPUB/PDF readers work unchanged.

### 4.2 Source Attribution in UI

Add a `source` column to the `books` table (or use the `google_drive_files` join) to display a small Google Drive icon/badge on books that originated from Drive. This helps the user distinguish local vs. Drive-synced books.

```sql
ALTER TABLE books ADD COLUMN source TEXT DEFAULT 'local' NOT NULL;
```

The watcher would need a small update: when inserting books from the `google-drive/` subdirectory, set `source = 'google-drive'`. Alternatively, derive this from the `file_path` containing `google-drive/` at query time to avoid changing the Rust watcher.

### 4.3 Lazy/On-Demand Download (Future Enhancement)

For large libraries, downloading everything eagerly may not be practical. A future version could:
- Show Drive files in the library as "cloud" entries (metadata only, no local file).
- Download on first read attempt via a modified `/api/books/[id]/file` that triggers a Drive download if the file isn't cached locally.
- This requires more significant changes to the book model and reader, so it's deferred.

---

## Phase 5: Change Monitoring & Real-Time Updates

### 5.1 Drive Changes API (Push Notifications)

Google Drive supports [push notifications via webhooks](https://developers.google.com/drive/api/guides/push) (`changes.watch`). This is more efficient than polling but requires:
- A publicly accessible HTTPS endpoint.
- A registered webhook channel that expires and must be renewed.

**Implementation:**
- **`POST /api/google-drive/webhook`** — Receives Drive change notifications.
  - Validates the `X-Goog-Channel-Token` header against stored channel info.
  - Triggers an incremental sync for the affected user.
- **Channel management** — On connect, register a changes watch channel. Store `channelId`, `resourceId`, `expiration` in `google_drive_connections`. Renew before expiration.

**Fallback:** If the app is behind NAT or doesn't have a public URL (Electron desktop), fall back to periodic polling from Phase 3.

### 5.2 Library SSE Integration

The existing `/api/library/events` SSE endpoint polls a `library_version` counter. After a Drive sync adds/updates books, the watcher already increments this counter, so the frontend will automatically refresh. No changes needed here.

---

## Implementation Order & File Map

### Migration & Schema
| File | Description |
|------|-------------|
| `src/lib/db/migrations/0001_google_drive.sql` | New tables: `google_drive_connections`, `google_drive_files`; `ALTER TABLE books ADD COLUMN source` |
| `scripts/db-push.js` | Update to apply new migration |

### Google Drive Auth
| File | Description |
|------|-------------|
| `src/lib/google-drive/auth.ts` | OAuth URL generation, token exchange, token refresh |
| `src/app/api/google-drive/auth/route.ts` | `GET` (start OAuth), `DELETE` (disconnect) |
| `src/app/api/google-drive/callback/route.ts` | `GET` (OAuth callback, exchange code for tokens) |

### Google Drive API
| File | Description |
|------|-------------|
| `src/lib/google-drive/client.ts` | Configured `google.drive()` client factory using stored tokens |
| `src/app/api/google-drive/files/route.ts` | List PDF/EPUB files |
| `src/app/api/google-drive/folders/route.ts` | List folders for picker |
| `src/app/api/google-drive/status/route.ts` | Connection status |
| `src/app/api/google-drive/settings/route.ts` | Save sync preferences |

### Sync Engine
| File | Description |
|------|-------------|
| `src/lib/google-drive/sync.ts` | Core sync logic: list, diff, download, track |
| `src/app/api/google-drive/sync/route.ts` | `POST` trigger sync |
| `src/app/api/google-drive/webhook/route.ts` | Drive push notification receiver (Phase 5) |

### Frontend
| File | Description |
|------|-------------|
| `src/app/(dashboard)/admin/integrations/page.tsx` | Integrations settings page |
| `src/components/google-drive/GoogleDriveCard.tsx` | Connect/disconnect UI |
| `src/components/google-drive/DriveFolderPicker.tsx` | Folder browser/selector |
| `src/components/google-drive/DriveSyncStatus.tsx` | Sync status, last sync, manual trigger |
| `src/app/(dashboard)/admin/layout.tsx` | Add "Integrations" nav link |

### Config
| File | Description |
|------|-------------|
| `.env.example` | Add `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` |
| `next.config.ts` | No changes expected |
| `package.json` | Add `googleapis` dependency |

---

## Security Considerations

1. **Token storage** — Refresh tokens are stored in SQLite. For production, consider encrypting at rest using a key derived from `NEXTAUTH_SECRET`.
2. **Scope minimization** — Request only `drive.readonly`. Never request write access.
3. **CSRF on OAuth** — The `state` parameter in the OAuth flow must contain a signed/verifiable value tied to the user's session.
4. **Webhook validation** — Verify the `X-Goog-Channel-Token` on incoming webhook requests to prevent spoofed notifications.
5. **Rate limiting** — Google Drive API has quotas (default 12,000 queries/100 seconds). The sync engine should batch requests and respect rate limits.
6. **File size limits** — Set a maximum file size for downloads (e.g., 200MB) to prevent storage exhaustion.

---

## Electron vs. Web Considerations

| Concern | Web/Docker | Electron |
|---------|-----------|----------|
| OAuth redirect | Standard web redirect | Open system browser, use deep link or localhost redirect |
| Webhook (push) | Works if publicly accessible | Not available; use polling only |
| Sync scheduling | External cron or SSE-based timer | `setInterval` in main process |
| File storage | `LIBRARY_PATH/google-drive/` | Same, under user-configured library path |

For Electron, the OAuth flow will need to open the system browser and capture the callback. This can use a temporary local HTTP server on a random port, or Electron's `protocol.registerHttpProtocol` for a custom scheme redirect.

---

## Suggested Build Order

1. **Phase 1** — OAuth + token storage (env setup, migration, auth routes, token refresh)
2. **Phase 2** — File/folder listing APIs + settings UI (integrations page, connect/disconnect)
3. **Phase 3** — Sync engine + manual sync (download files, let watcher index, sync status)
4. **Phase 4** — Source attribution in library UI (badge on Drive-sourced books)
5. **Phase 5** — Webhook-based change monitoring (optional, for publicly-hosted deployments)
