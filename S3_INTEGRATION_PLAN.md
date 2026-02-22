# S3 / R2 Bucket Integration Plan

Connect an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, etc.) and get
the same automatic scanning and import experience as a local library folder.
**Files remain in the bucket — nothing is downloaded to disk for storage.**
All new logic lives in Rust (`watcher-rs`).

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Configuration & Credentials](#2-configuration--credentials)
3. [Database Changes](#3-database-changes)
4. [Rust: S3 Client Module](#4-rust-s3-client-module)
5. [Rust: S3 Scanner](#5-rust-s3-scanner)
6. [Rust: S3 Polling Watcher](#6-rust-s3-polling-watcher)
7. [Rust: Metadata Extraction Over S3](#7-rust-metadata-extraction-over-s3)
8. [Rust: Cover Generation](#8-rust-cover-generation)
9. [Rust: S3 File Streaming & Presigned URLs](#9-rust-s3-file-streaming--presigned-urls)
10. [TypeScript: File-Serving Adaptations](#10-typescript-file-serving-adaptations)
11. [TypeScript: Admin UI for S3 Sources](#11-typescript-admin-ui-for-s3-sources)
12. [Orphan Cleanup & Deletion](#12-orphan-cleanup--deletion)
13. [Implementation Phases](#13-implementation-phases)

---

## 1. Design Principles

| Principle | Detail |
|-----------|--------|
| **No local file copies** | Book files are never persisted to the local filesystem. Covers are still stored locally (small JPEGs, needed for fast thumbnail serving). |
| **Transient reads only** | During scanning, file bytes are streamed into an in-memory buffer for metadata extraction, then discarded. |
| **S3-compatible** | Works with any service that speaks the S3 API: AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, etc. Requires only a configurable endpoint URL. |
| **Entirely in Rust** | All S3 communication — authentication, listing, reading, streaming — is implemented in the `watcher-rs` binary. TypeScript only calls Rust subcommands. |
| **Same UX as local** | Books appear in the library with covers, metadata, and reading progress, identically to local-folder books. |
| **Coexistence** | A local library folder and an S3 bucket can be active simultaneously. Books from each source are distinguished by a `source` column. |

---

## 2. Configuration & Credentials

### 2.1 Environment Variables

```
S3_ENDPOINT=https://abc123.r2.cloudflarestorage.com   # Required for R2/MinIO; omit for AWS
S3_REGION=auto                                         # "auto" for R2, "us-east-1" for AWS, etc.
S3_BUCKET=my-ebooks                                    # Bucket name
S3_ACCESS_KEY_ID=AKIA...                               # Access key
S3_SECRET_ACCESS_KEY=wJal...                            # Secret key
S3_PREFIX=books/                                       # Optional — only scan objects under this prefix
S3_POLL_INTERVAL=60                                    # Seconds between scan cycles (default 60)
```

### 2.2 CLI Arguments

New arguments on the `watcher-rs` binary (mirrors env vars):

```
--s3-endpoint <URL>
--s3-region <REGION>
--s3-bucket <BUCKET>
--s3-access-key <KEY>
--s3-secret-key <SECRET>
--s3-prefix <PREFIX>
--s3-poll-interval <SECONDS>
```

### 2.3 Docker / Electron

- **Docker:** Pass env vars via `docker-compose.yml` or `-e` flags.
- **Electron:** Store credentials in `electron/store.ts` (encrypted), expose
  via a settings UI, and pass to the Rust binary as CLI args when spawning.

---

## 3. Database Changes

### 3.1 New Column on `books`

```sql
ALTER TABLE books ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
-- Values: 'local' | 's3'
```

- `source = 'local'` — existing behavior, `file_path` is an absolute disk path.
- `source = 's3'` — `file_path` stores the S3 object key (e.g. `books/Rust Programming.epub`).

### 3.2 New Column: `s3_bucket`

```sql
ALTER TABLE books ADD COLUMN s3_bucket TEXT;
-- NULL for local books; bucket name for S3 books.
```

Storing the bucket name per-book (rather than relying on env config at
query time) makes the system resilient to bucket changes and supports
multiple buckets in the future.

### 3.3 New Column: `s3_etag`

```sql
ALTER TABLE books ADD COLUMN s3_etag TEXT;
-- The ETag returned by S3 ListObjectsV2 / HeadObject.
```

ETags are used for **cheap change detection** during polling. If the ETag
hasn't changed, the file hasn't changed, and we skip re-extraction. This
avoids downloading files just to recompute a SHA-256 hash.

For S3 books, `file_hash` is still populated (SHA-256 of the full object
during the initial import) for deduplication across sources. But subsequent
change detection uses the ETag.

### 3.4 Migration

A new SQL migration file:

```
src/lib/db/migrations/0001_s3_source_columns.sql
```

```sql
ALTER TABLE books ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE books ADD COLUMN s3_bucket TEXT;
ALTER TABLE books ADD COLUMN s3_etag TEXT;
```

The Rust `Database` struct and `NewBook`/`UpdateBook` structs gain these fields.

---

## 4. Rust: S3 Client Module

### 4.1 Crate Choice

Use **`rust-s3`** (`s3` crate, version 0.35+). It's a self-contained,
async-capable S3 client that supports:

- Custom endpoints (R2, MinIO)
- `ListObjectsV2`, `GetObject`, `HeadObject`
- Byte-range reads (`Range` header)
- Presigned URL generation
- Works with `tokio` runtime

Add to `Cargo.toml`:

```toml
s3 = { version = "0.35", default-features = false, features = ["tokio-rustls-tls"] }
tokio = { version = "1", features = ["rt", "macros"] }
```

`tokio-rustls-tls` avoids a native OpenSSL dependency, simplifying
cross-compilation (important for Docker + Electron builds).

### 4.2 Module Structure

```
watcher-rs/src/
├── s3/
│   ├── mod.rs          # Re-exports, S3Config struct
│   ├── client.rs       # Bucket handle creation, credential loading
│   ├── scanner.rs      # ListObjectsV2 pagination, diff computation
│   ├── reader.rs       # GetObject streaming, range reads
│   └── presign.rs      # Presigned URL generation
```

### 4.3 `S3Config` Struct

```rust
pub struct S3Config {
    pub endpoint: Option<String>,   // None → default AWS
    pub region: String,             // "auto", "us-east-1", etc.
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub prefix: Option<String>,     // e.g. "books/"
    pub poll_interval: u64,         // seconds
}
```

### 4.4 Client Initialization

```rust
pub fn create_bucket(config: &S3Config) -> Result<Box<Bucket>> {
    let region = if let Some(ref endpoint) = config.endpoint {
        Region::Custom { region: config.region.clone(), endpoint: endpoint.clone() }
    } else {
        config.region.parse()?
    };
    let credentials = Credentials::new(
        Some(&config.access_key),
        Some(&config.secret_key),
        None, None, None,
    )?;
    let bucket = Bucket::new(&config.bucket, region, credentials)?
        .with_path_style(); // Required for MinIO/R2
    Ok(bucket)
}
```

---

## 5. Rust: S3 Scanner

### 5.1 Object Listing

Paginate through `ListObjectsV2`, collecting all `.pdf` and `.epub` objects:

```rust
pub struct S3Object {
    pub key: String,
    pub size: u64,
    pub etag: String,
    pub last_modified: i64,   // Unix timestamp
}

pub async fn list_objects(bucket: &Bucket, prefix: Option<&str>) -> Result<Vec<S3Object>> {
    let mut objects = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let (list, _status) = bucket
            .list_page(prefix.unwrap_or(""), None, continuation_token.as_deref(), None, Some(1000))
            .await?;

        for item in &list.contents {
            let key_lower = item.key.to_lowercase();
            if key_lower.ends_with(".pdf") || key_lower.ends_with(".epub") {
                objects.push(S3Object {
                    key: item.key.clone(),
                    size: item.size as u64,
                    etag: item.e_tag.clone().unwrap_or_default(),
                    last_modified: /* parse item.last_modified */,
                });
            }
        }

        match list.next_continuation_token {
            Some(token) => continuation_token = Some(token),
            None => break,
        }
    }

    Ok(objects)
}
```

### 5.2 Diff Computation

Compare the S3 listing against the DB to determine what changed:

```rust
pub struct ScanDiff {
    pub added: Vec<S3Object>,       // New objects not in DB
    pub changed: Vec<S3Object>,     // Objects whose ETag differs from DB
    pub removed: Vec<OrphanRow>,    // DB records whose key is no longer in S3
}

pub fn compute_diff(s3_objects: &[S3Object], db_books: &[S3BookRow], bucket: &str) -> ScanDiff {
    let s3_map: HashMap<&str, &S3Object> = s3_objects.iter().map(|o| (o.key.as_str(), o)).collect();
    let db_map: HashMap<&str, &S3BookRow> = db_books.iter().map(|b| (b.file_path.as_str(), b)).collect();

    let added = s3_objects.iter()
        .filter(|o| !db_map.contains_key(o.key.as_str()))
        .cloned().collect();

    let changed = s3_objects.iter()
        .filter(|o| db_map.get(o.key.as_str()).map_or(false, |b| b.s3_etag.as_deref() != Some(&o.etag)))
        .cloned().collect();

    let removed = db_books.iter()
        .filter(|b| !s3_map.contains_key(b.file_path.as_str()))
        .cloned().collect();

    ScanDiff { added, changed, removed }
}
```

---

## 6. Rust: S3 Polling Watcher

### 6.1 New CLI Subcommand

```rust
#[derive(Subcommand)]
enum Command {
    Db(DbCommand),
    S3Watch(S3WatchCommand),   // <-- new
    S3Stream(S3StreamCommand), // <-- new (see §9)
}

#[derive(Args)]
struct S3WatchCommand {
    #[arg(long, env = "S3_ENDPOINT")]
    s3_endpoint: Option<String>,
    #[arg(long, env = "S3_REGION", default_value = "auto")]
    s3_region: String,
    #[arg(long, env = "S3_BUCKET")]
    s3_bucket: String,
    #[arg(long, env = "S3_ACCESS_KEY_ID")]
    s3_access_key: String,
    #[arg(long, env = "S3_SECRET_ACCESS_KEY")]
    s3_secret_key: String,
    #[arg(long, env = "S3_PREFIX")]
    s3_prefix: Option<String>,
    #[arg(long, env = "S3_POLL_INTERVAL", default_value = "60")]
    s3_poll_interval: u64,
    #[arg(long, env = "DATABASE_PATH", default_value = "./data/library.db")]
    db_path: String,
    #[arg(long, env = "COVERS_PATH", default_value = "./data/covers")]
    covers_path: String,
}
```

### 6.2 Polling Loop

```
fn run_s3_watch(args, shutdown) -> Result<()>:
    1. Build S3Config from args
    2. Create tokio runtime
    3. Open database
    4. Log "[S3] Watching s3://{bucket}/{prefix}..."
    5. Loop:
       a. List all objects from S3
       b. Query all S3 books from DB (WHERE source = 's3' AND s3_bucket = ?)
       c. Compute diff (added, changed, removed)
       d. For each added:  handle_s3_add(bucket, object, db, covers_dir)
       e. For each changed: handle_s3_change(bucket, object, db, covers_dir)
       f. For each removed: handle_s3_delete(db, book)
       g. If any changes: increment library_version
       h. Sleep for poll_interval seconds (interruptible by shutdown flag)
```

### 6.3 Parallel Operation with Local Watcher

The `s3-watch` subcommand runs as a separate process alongside the local
`watcher-rs` (which uses `notify`). In Docker, both can be launched:

```yaml
# docker-compose.yml
services:
  alex:
    command: sh -c "./watcher-rs & ./watcher-rs s3-watch & exec node server.js"
```

In Electron, `electron/main.ts` spawns both processes.

---

## 7. Rust: Metadata Extraction Over S3

### 7.1 Strategy: Transient In-Memory Download

Files are downloaded **into memory** (not to disk) for metadata extraction.
After extraction, the buffer is dropped. This is the only practical approach
given that `lopdf`, `zip`, and `pdfium-render` all require full random access
to the file.

For very large files (>100 MB), a temp file with automatic cleanup is used
instead to avoid excessive memory pressure.

```rust
async fn fetch_object_bytes(bucket: &Bucket, key: &str, size: u64) -> Result<ObjectBytes> {
    let response = bucket.get_object(key).await?;
    let bytes = response.bytes().to_vec();
    if size > 100_000_000 {
        // Write to temp file, return path (auto-deleted on drop)
        let tmp = tempfile::NamedTempFile::new()?;
        std::io::Write::write_all(&mut tmp.as_file(), &bytes)?;
        Ok(ObjectBytes::TempFile(tmp))
    } else {
        Ok(ObjectBytes::Memory(bytes))
    }
}
```

### 7.2 Adapting Extractors

The existing extractors work with `&Path`. Add parallel functions that work
with byte slices:

**PDF (`extractors/pdf.rs`):**

```rust
pub fn extract_pdf_metadata_from_bytes(bytes: &[u8], fallback_title: &str) -> BookMetadata {
    match try_extract_from_bytes(bytes, fallback_title) {
        Ok(meta) => meta,
        Err(_) => BookMetadata { title: fallback_title.to_string(), ..Default::default() },
    }
}

fn try_extract_from_bytes(bytes: &[u8], fallback_title: &str) -> Result<BookMetadata> {
    let doc = lopdf::Document::load_mem(bytes)?;   // <-- lopdf supports this
    // ... same logic as try_extract() ...
}
```

**EPUB (`extractors/epub.rs`):**

```rust
pub fn extract_epub_metadata_from_bytes(bytes: &[u8], fallback_title: &str) -> BookMetadata {
    match try_extract_epub_from_bytes(bytes, fallback_title) {
        Ok(meta) => meta,
        Err(_) => BookMetadata { title: fallback_title.to_string(), ..Default::default() },
    }
}

fn try_extract_epub_from_bytes(bytes: &[u8], fallback_title: &str) -> Result<BookMetadata> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;   // <-- zip supports Read+Seek
    // ... same OPF parsing logic ...
}
```

### 7.3 Hash Computation

SHA-256 is computed from the in-memory buffer before it's discarded:

```rust
let hash = {
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    format!("{:x}", hasher.finalize())
};
```

---

## 8. Rust: Cover Generation

### 8.1 EPUB Covers from Bytes

Add `extract_epub_cover_from_bytes(bytes, book_id, covers_dir)`:
- Opens ZIP from `Cursor<&[u8]>`
- Same OPF → cover-image lookup
- Extracts cover image, saves to `covers_dir/{book_id}.jpg`

### 8.2 PDF Covers from Bytes

Add `render_pdf_cover_from_bytes(bytes, book_id, covers_dir)`:
- `pdfium-render` requires either a file path or a byte buffer — check if
  `Pdfium::load_pdf_from_byte_slice()` is available (it is in 0.8.x).
- Render first page, save JPEG.
- If unavailable, fall through to synthetic cover.

### 8.3 Fallback

The existing `generate_synthetic_cover()` works unchanged — it only needs
title + author strings, no file access.

---

## 9. Rust: S3 File Streaming & Presigned URLs

### 9.1 Streaming Subcommand

New `s3-stream` subcommand for piping S3 object bytes to stdout:

```
watcher-rs s3-stream \
  --s3-endpoint https://... \
  --s3-bucket my-ebooks \
  --s3-access-key AKIA... \
  --s3-secret-key wJal... \
  --key "books/Rust Programming.epub" \
  --range "bytes=0-1048575"          # optional
```

Behavior:
1. Calls `GetObject` with optional `Range` header.
2. Writes response body to stdout.
3. Writes a JSON header line first: `{"content_length": 12345, "content_type": "application/epub+zip"}\n`
4. Then raw bytes follow.

This lets the TypeScript API route read the header, set HTTP response headers,
then pipe the rest directly to the client.

### 9.2 Presigned URL Subcommand

Alternative approach — generate a short-lived presigned URL:

```
watcher-rs s3-presign \
  --s3-endpoint https://... \
  --s3-bucket my-ebooks \
  --s3-access-key AKIA... \
  --s3-secret-key wJal... \
  --key "books/Rust Programming.epub" \
  --expires 3600
```

Outputs a single presigned URL to stdout. The TypeScript route can redirect
(HTTP 307) to this URL, offloading bandwidth from the Alex server.

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| **Streaming (proxy)** | Works with private buckets behind firewalls; consistent auth model | Double bandwidth (S3 → server → client) |
| **Presigned URL (redirect)** | Zero server bandwidth; direct client ↔ S3 | Client must reach S3 endpoint; CORS config needed; URL leaks temporarily |

**Recommendation:** Default to **streaming** for maximum compatibility.
Offer presigned URLs as an opt-in (`S3_PRESIGN=true`) for users who want
to offload bandwidth.

---

## 10. TypeScript: File-Serving Adaptations

### 10.1 Detecting S3 Books

The `file/route.ts` endpoint checks the `source` column:

```typescript
const book = await queryOne<{ filePath: string; fileType: string; source: string; s3Bucket: string | null }>(
  `SELECT file_path AS filePath, file_type AS fileType, source, s3_bucket AS s3Bucket
   FROM books WHERE id = ?1 LIMIT 1`,
  [id]
);

if (book.source === 's3') {
  return streamFromS3(book, req);
} else {
  return streamFromDisk(book, req);   // existing logic
}
```

### 10.2 `streamFromS3()`

Spawns the Rust binary:

```typescript
async function streamFromS3(book: S3Book, req: Request): Promise<NextResponse> {
  const rangeHeader = req.headers.get("range");
  const args = [
    "s3-stream",
    "--key", book.filePath,
    // S3 credentials passed via env vars (inherited by child process)
  ];
  if (rangeHeader) args.push("--range", rangeHeader);

  const child = spawn(watcherBinary, args);
  // Read JSON header line, then pipe body
  // ...
}
```

### 10.3 Shared Collection Routes

The same adaptation applies to `/api/shared/[token]/books/[bookId]/file`.

### 10.4 Cover Routes

No changes needed — covers are stored locally in `COVERS_PATH` regardless
of book source.

---

## 11. TypeScript: Admin UI for S3 Sources

### 11.1 Settings Page

Add an "S3 / Cloud Storage" section to the admin settings page:

- **Endpoint URL** — text input (placeholder: "Leave blank for AWS S3")
- **Region** — text input (default: "auto")
- **Bucket Name** — text input
- **Access Key** — text input
- **Secret Key** — password input
- **Prefix** — text input (optional, placeholder: "e.g. books/")
- **Poll Interval** — number input (default: 60 seconds)
- **Test Connection** button — calls a new API endpoint that spawns
  `watcher-rs s3-stream --key "" --dry-run` to validate credentials.

### 11.2 Settings Storage

Store S3 configuration in the `settings` table as JSON:

```sql
INSERT INTO settings (key, value, updated_at)
VALUES ('s3_config', '{"endpoint":"...","bucket":"...","region":"..."}', ...);
```

The watcher process reads this on startup. When settings change, the admin
UI signals the watcher to restart its polling loop (via a `SIGHUP` or by
stopping/restarting the process).

---

## 12. Orphan Cleanup & Deletion

### 12.1 S3 Orphan Detection

During each poll cycle, any book in the DB with `source = 's3'` whose object
key is no longer in the S3 listing is treated as deleted:

- Delete the local cover file (if any).
- Delete the DB record.
- Increment `library_version`.

### 12.2 Local vs S3 Isolation

Orphan cleanup for local books (existing `remove_orphaned_books()`) only
touches books where `source = 'local'`. The S3 scanner only touches books
where `source = 's3'`.

### 12.3 Book Deletion from UI

If a user deletes an S3 book from the Alex UI, it only removes the DB record
and local cover — the file in S3 is **not** deleted (read-only relationship).
The next scan cycle will re-import it unless the user also removes it from S3.

---

## 13. Implementation Phases

### Phase 1: Foundation (Rust)

**Goal:** S3 client, object listing, one-shot scan with metadata extraction.

1. Add `s3` and `tokio` crates to `Cargo.toml`.
2. Create `src/s3/` module with `S3Config`, `create_bucket()`.
3. Implement `list_objects()` with pagination.
4. Add `_from_bytes()` variants to PDF and EPUB extractors.
5. Add `_from_bytes()` variants to PDF and EPUB cover generators.
6. Add `source`, `s3_bucket`, `s3_etag` columns to `NewBook`/`UpdateBook`/`Database`.
7. Implement `handle_s3_add()`: fetch bytes → extract metadata → generate cover → insert DB.
8. Add new `s3-scan` subcommand (one-shot: list, diff, import, exit).
9. **Test:** Point at a real S3/R2 bucket with a few books, verify import.

### Phase 2: Polling Watcher (Rust)

**Goal:** Continuous background scanning with change detection.

1. Implement `compute_diff()` (added/changed/removed).
2. Implement `handle_s3_change()` (re-extract metadata if ETag changed).
3. Implement S3 orphan cleanup.
4. Add `s3-watch` subcommand with polling loop + shutdown signal.
5. Update `remove_orphaned_books()` to filter by `source = 'local'`.
6. **Test:** Add/remove files from bucket, verify library updates.

### Phase 3: File Streaming (Rust + TypeScript)

**Goal:** Serve S3-hosted books to the reader.

1. Implement `s3-stream` subcommand (GetObject → stdout with header line).
2. Implement `s3-presign` subcommand (optional).
3. Add SQL migration file for new columns.
4. Modify `file/route.ts` to detect S3 books and call `s3-stream`.
5. Modify shared collection file route similarly.
6. **Test:** Open a PDF and EPUB hosted in S3 in the reader.

### Phase 4: Admin UI & Polish (TypeScript)

**Goal:** User-friendly setup and configuration.

1. Add S3 settings section to admin page.
2. Add "Test Connection" API endpoint.
3. Store/retrieve config from `settings` table.
4. Wire process spawning (Docker `entrypoint`, Electron `main.ts`).
5. Add `source` badge/indicator to book cards (optional, subtle).
6. Update Docker Compose example with S3 env vars.
7. **Test:** End-to-end: configure S3 in UI → books appear → read a book.

### Phase 5: Optimization (Optional)

**Goal:** Reduce bandwidth and improve scan performance.

1. **Partial reads for EPUB metadata:** Fetch only the ZIP central directory
   (last ~64 KB via range request), parse it to find `container.xml` and OPF,
   then fetch only those entries. Avoids downloading multi-hundred-MB EPUBs
   just for metadata.
2. **Conditional fetching:** Use `If-None-Match` with stored ETags to skip
   unchanged objects during change checks.
3. **Concurrent extraction:** Process multiple new books in parallel during
   scan (bounded concurrency with `tokio::sync::Semaphore`).
4. **Streaming hash:** Compute SHA-256 while streaming the GetObject response
   instead of buffering the entire file first.

---

## Appendix: Crate Compatibility Notes

| Crate | In-Memory Support | Notes |
|-------|-------------------|-------|
| `lopdf 0.34` | `Document::load_mem(&[u8])` | Full support. |
| `zip 2` | `ZipArchive::new(Cursor<Vec<u8>>)` | Needs `Read + Seek`; `Cursor` satisfies both. |
| `pdfium-render 0.8` | `Pdfium::load_pdf_from_byte_slice()` | Available since 0.8.x. |
| `image 0.25` | `image::load_from_memory()` | Full support. |
| `sha2 0.10` | `hasher.update(&bytes)` | Full support. |

All existing extraction and cover-generation crates support in-memory
operation, so no crate replacements are needed.

## Appendix: S3 vs Local Book Lifecycle Comparison

```
                    LOCAL                           S3
                    ─────                           ──
Discovery           notify (inotify/FSEvents)       ListObjectsV2 polling
Stability check     2s file-size debounce           ETag comparison
Hash                SHA-256 of file on disk         SHA-256 of streamed bytes
Metadata            Read from file path             Read from memory buffer
Cover               Read from file path             Read from memory buffer
DB insert           file_path = /abs/path           file_path = object-key
                    source = 'local'                source = 's3'
                    s3_bucket = NULL                 s3_bucket = 'my-bucket'
                    s3_etag = NULL                   s3_etag = '"abc123"'
Serving             fs.createReadStream()           watcher-rs s3-stream → pipe
Deletion            notify Remove event             Object absent from listing
Orphan cleanup      Check file exists on disk       Check key exists in listing
```
