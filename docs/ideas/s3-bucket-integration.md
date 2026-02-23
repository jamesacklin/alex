# S3 / R2 Bucket Integration (Implemented)

This document describes the shipped S3-compatible storage support in Alex and the current extension points for additional providers.

## Status

Implemented in the current codebase:

- S3-compatible ingestion in `watcher-rs` (Cloudflare R2, AWS S3, MinIO, etc.)
- Source-aware DB model (`books.source`, `books.s3_bucket`, `books.s3_etag`)
- Unified file-serving path for private and shared readers via `serveBookFile()`
- Typed source driver registry (`SOURCE_HANDLERS`) with per-source config validation

## Runtime Mode Model

Alex runs one ingestion mode per process:

- Local mode: watcher monitors `LIBRARY_PATH`
- S3 mode: watcher polls a configured bucket/prefix

Mode selection:

- Web/Docker: `S3_BUCKET` present => S3 mode; otherwise local mode
- Electron: selected in onboarding/admin (`Local Folder` vs `S3 / R2 Bucket`)

## Configuration Contract

Required environment variables for S3 mode:

```env
S3_BUCKET=my-books
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Optional:

```env
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_PREFIX=books/
S3_POLL_INTERVAL=60
```

Notes:

- `S3_REGION=auto` is recommended for Cloudflare R2.
- `S3_ENDPOINT` is required for non-AWS providers (R2/MinIO).

## Database Semantics

The `books` table stores source-specific metadata:

- `source`: `'local'` or `'s3'`
- `file_path`:
  - local book => absolute disk path
  - S3 book => object key
- `s3_bucket`: bucket name for S3 rows
- `s3_etag`: object ETag used by the S3 poller for change detection

`file_hash` remains global SHA-256 content identity for duplicate prevention.

## Ingestion Architecture

### Local mode

`watcher-rs` uses `notify` file events and local handlers:

- `handle_add`
- `handle_change`
- `handle_delete`

### S3 mode

`watcher-rs` runs a poll/diff loop:

- list bucket objects (filtered to `.pdf` / `.epub`)
- compute `added` / `changed` / `removed`
- process via:
  - `handle_s3_add`
  - `handle_s3_change`
  - `handle_s3_delete`

Both modes increment `settings.library_version` so UI refresh behavior is identical.

## Unified File-Serving Pipeline

All book routes use one source-aware helper: `src/lib/files/serve-book-file.ts`.

Route callers:

- `GET /api/books/[id]/file`
- `GET /api/books/[id]/book.epub`
- `GET /api/shared/[token]/books/[bookId]/file`
- `GET /api/shared/[token]/books/[bookId]/book.epub`

Core abstractions:

- `SourceDriver` interface
- `SOURCE_HANDLERS: Record<string, SourceDriver>` registry
- `validateConfig` hook for typed per-source config checks

Current handlers:

- `local`: streams from disk with range support
- `s3`: validates env + streams through `watcher-rs s3-stream`

This eliminates route-level branching by source and keeps authenticated/public behavior aligned.

## Streaming Behavior for S3

S3 streaming uses watcher subcommand:

```sh
watcher-rs s3-stream --key <object-key> [--range bytes=START-END]
```

It emits:

1. JSON header line (content metadata)
2. raw object bytes

The Next route wraps this into a normal HTTP response (`200` / `206`, content headers, range headers) so readers do not need source-specific logic.

## Operator Notes

- In S3 mode, book files stay in object storage; only metadata and covers are local.
- Browser reads go through Alex routes; clients do not directly call the bucket.
- Most deployments do not require bucket CORS for in-app reading.
- In Electron, changing storage mode clears library state and restarts managed processes.

## Error Surfaces

Frontend request error handling includes source/provider-aware presentation for:

- `403` forbidden
- `404` not found
- `500` server errors
- CORS-like failures
- S3/provider connection failures

These map to visible toasts in library/reader workflows.

## Test Coverage

Current coverage includes:

- JS unit tests for `serveBookFile` source behavior and error handling
- JS unit tests for request error classification
- Rust unit tests for:
  - S3 diff scanner
  - S3 stream range parsing
  - S3 handler DB behaviors (add/change/delete)
  - S3 fetch failure propagation

## Adding the Next Source

To add a new backend (for example Google Drive, GCS, Azure Blob):

1. Add source metadata fields only if needed in DB/migrations.
2. Implement provider ingestion in watcher/service layer.
3. Register one new `SourceDriver` in `SOURCE_HANDLERS`.
4. Implement `validateConfig` for required provider config.
5. Reuse existing file routes unchanged.
6. Add provider-specific unit tests mirroring local/S3 coverage patterns.

The key contract is that route-level code stays source-agnostic.
