use anyhow::{Context, Result};
use s3::Bucket;
use sha2::{Digest, Sha256};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use super::scanner::{S3Object, title_from_key};
use crate::covers::{generate_epub_cover_from_bytes, generate_pdf_cover_from_bytes};
use crate::db::{Database, NewBook, UpdateBook, unix_now};
use crate::log::log;

type FetchFuture<'a> = Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + 'a>>;

/// Download bytes for an S3 object (fully buffered).
async fn fetch_object_bytes(bucket: &Bucket, key: &str) -> Result<Vec<u8>> {
    let response = bucket
        .get_object(key)
        .await
        .with_context(|| format!("Failed to download s3://{}", key))?;

    if response.status_code() != 200 {
        anyhow::bail!(
            "S3 GetObject returned status {} for key: {}",
            response.status_code(),
            key
        );
    }

    Ok(response.to_vec())
}

trait ObjectBytesFetcher {
    fn fetch_object_bytes<'a>(&'a self, key: &'a str) -> FetchFuture<'a>;
}

struct BucketObjectFetcher<'a> {
    bucket: &'a Bucket,
}

impl ObjectBytesFetcher for BucketObjectFetcher<'_> {
    fn fetch_object_bytes<'a>(&'a self, key: &'a str) -> FetchFuture<'a> {
        Box::pin(fetch_object_bytes(self.bucket, key))
    }
}

fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn file_type_from_key(key: &str) -> &str {
    if key.to_lowercase().ends_with(".pdf") {
        "pdf"
    } else {
        "epub"
    }
}

/// Process a newly discovered S3 object: download, extract metadata, generate cover, insert into DB.
pub async fn handle_s3_add(
    bucket: &Bucket,
    object: &S3Object,
    db: &Database,
    bucket_name: &str,
    covers_dir: &Path,
) -> Result<()> {
    let fetcher = BucketObjectFetcher { bucket };
    handle_s3_add_with_fetcher(&fetcher, object, db, bucket_name, covers_dir).await
}

async fn handle_s3_add_with_fetcher(
    fetcher: &dyn ObjectBytesFetcher,
    object: &S3Object,
    db: &Database,
    bucket_name: &str,
    covers_dir: &Path,
) -> Result<()> {
    let file_type = file_type_from_key(&object.key);
    let fallback_title = title_from_key(&object.key);

    let bytes = fetcher.fetch_object_bytes(&object.key).await?;
    if bytes.is_empty() {
        log(&format!("[S3] [SKIP] Zero-byte object: {}", object.key));
        return Ok(());
    }

    let file_hash = compute_sha256(&bytes);

    if let Some(existing_title) = db.find_by_hash(&file_hash)? {
        log(&format!(
            "[S3] [SKIP] Duplicate (matches \"{}\"): {}",
            existing_title, object.key
        ));
        return Ok(());
    }

    let book_id = uuid::Uuid::new_v4().to_string();

    let metadata = if file_type == "pdf" {
        crate::extractors::pdf::extract_pdf_metadata_from_bytes(&bytes, &fallback_title)
    } else {
        crate::extractors::epub::extract_epub_metadata_from_bytes(&bytes, &fallback_title)
    };

    let cover_path = if file_type == "pdf" {
        generate_pdf_cover_from_bytes(
            &bytes,
            &book_id,
            &metadata.title,
            metadata.author.as_deref(),
            covers_dir,
        )
    } else {
        generate_epub_cover_from_bytes(
            &bytes,
            &book_id,
            &metadata.title,
            metadata.author.as_deref(),
            covers_dir,
        )
    };
    let cover_path_str = cover_path.as_ref().and_then(|p| p.to_str());

    let now = unix_now();

    let changes = db.insert_book(&NewBook {
        id: &book_id,
        title: &metadata.title,
        author: metadata.author.as_deref(),
        description: metadata.description.as_deref(),
        file_type,
        file_path: &object.key,
        file_size: bytes.len() as i64,
        file_hash: &file_hash,
        cover_path: cover_path_str,
        page_count: metadata.page_count.map(|p| p as i64),
        added_at: now,
        updated_at: now,
        source: "s3",
        s3_bucket: Some(bucket_name),
        s3_etag: Some(&object.etag),
    })?;

    if changes == 0 {
        log(&format!("[S3] [SKIP] Already exists: {}", object.key));
        return Ok(());
    }

    log(&format!(
        "[S3] [OK] Added \"{}\" ({})",
        metadata.title, file_type
    ));
    db.increment_library_version()?;
    Ok(())
}

/// Re-process an S3 object whose ETag changed: re-extract metadata and update DB.
pub async fn handle_s3_change(
    bucket: &Bucket,
    object: &S3Object,
    db: &Database,
    bucket_name: &str,
    covers_dir: &Path,
) -> Result<()> {
    let fetcher = BucketObjectFetcher { bucket };
    handle_s3_change_with_fetcher(&fetcher, object, db, bucket_name, covers_dir).await
}

async fn handle_s3_change_with_fetcher(
    fetcher: &dyn ObjectBytesFetcher,
    object: &S3Object,
    db: &Database,
    bucket_name: &str,
    covers_dir: &Path,
) -> Result<()> {
    let book = match db.find_by_path(&object.key)? {
        Some(b) => b,
        None => {
            log(&format!(
                "[S3] [INFO] Change for untracked key; adding: {}",
                object.key
            ));
            return handle_s3_add_with_fetcher(fetcher, object, db, bucket_name, covers_dir).await;
        }
    };

    let bytes = fetcher.fetch_object_bytes(&object.key).await?;
    let new_hash = compute_sha256(&bytes);

    if new_hash == book.file_hash {
        // ETag changed but content didn't (can happen with re-uploads of same content).
        // Just update the ETag.
        db.update_s3_etag(&book.id, &object.etag)?;
        log(&format!(
            "[S3] [SKIP] Hash unchanged for \"{}\", updated ETag",
            book.title
        ));
        return Ok(());
    }

    let file_type = file_type_from_key(&object.key);
    let fallback_title = title_from_key(&object.key);

    let metadata = if file_type == "pdf" {
        crate::extractors::pdf::extract_pdf_metadata_from_bytes(&bytes, &fallback_title)
    } else {
        crate::extractors::epub::extract_epub_metadata_from_bytes(&bytes, &fallback_title)
    };

    let cover_path = if file_type == "pdf" {
        generate_pdf_cover_from_bytes(
            &bytes,
            &book.id,
            &metadata.title,
            metadata.author.as_deref(),
            covers_dir,
        )
    } else {
        generate_epub_cover_from_bytes(
            &bytes,
            &book.id,
            &metadata.title,
            metadata.author.as_deref(),
            covers_dir,
        )
    };
    let cover_path_str = cover_path.as_ref().and_then(|p| p.to_str());

    // Clean up old cover if replaced
    if let Some(ref old_cover) = book.cover_path {
        let should_delete = match cover_path.as_ref() {
            Some(new_cover) => new_cover.to_string_lossy() != old_cover.as_str(),
            None => true,
        };
        if should_delete {
            let _ = std::fs::remove_file(old_cover);
        }
    }

    let now = unix_now();

    db.update_book(
        &book.id,
        &UpdateBook {
            title: &metadata.title,
            author: metadata.author.as_deref(),
            description: metadata.description.as_deref(),
            file_size: bytes.len() as i64,
            file_hash: &new_hash,
            cover_path: cover_path_str,
            page_count: metadata.page_count.map(|p| p as i64),
            updated_at: now,
            s3_etag: Some(&object.etag),
        },
    )?;

    log(&format!(
        "[S3] [UPDATE] \"{}\" -> \"{}\" ({})",
        book.title, metadata.title, book.file_type
    ));
    db.increment_library_version()?;
    Ok(())
}

/// Remove a book from the DB whose S3 object no longer exists.
pub fn handle_s3_delete(db: &Database, book: &crate::db::S3BookRow) -> Result<()> {
    if let Some(ref cover_path) = book.cover_path {
        let _ = std::fs::remove_file(cover_path);
    }

    db.delete_book(&book.id)?;

    log(&format!(
        "[S3] [DELETE] Removed \"{}\" from library",
        book.title
    ));
    db.increment_library_version()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[derive(Clone)]
    enum MockFetchResponse {
        Bytes(Vec<u8>),
        Error(String),
    }

    #[derive(Default)]
    struct MockFetcher {
        responses: HashMap<String, MockFetchResponse>,
    }

    impl MockFetcher {
        fn with_bytes(mut self, key: &str, bytes: &[u8]) -> Self {
            self.responses
                .insert(key.to_string(), MockFetchResponse::Bytes(bytes.to_vec()));
            self
        }

        fn with_error(mut self, key: &str, message: &str) -> Self {
            self.responses.insert(
                key.to_string(),
                MockFetchResponse::Error(message.to_string()),
            );
            self
        }
    }

    impl ObjectBytesFetcher for MockFetcher {
        fn fetch_object_bytes<'a>(&'a self, key: &'a str) -> FetchFuture<'a> {
            let response = self.responses.get(key).cloned();
            Box::pin(async move {
                match response {
                    Some(MockFetchResponse::Bytes(bytes)) => Ok(bytes),
                    Some(MockFetchResponse::Error(message)) => anyhow::bail!(message),
                    None => anyhow::bail!("No mock response configured for key: {key}"),
                }
            })
        }
    }

    fn s3_object(key: &str, etag: &str, size: u64) -> S3Object {
        S3Object {
            key: key.to_string(),
            size,
            etag: etag.to_string(),
        }
    }

    #[tokio::test]
    async fn handle_s3_add_inserts_s3_metadata() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key = "library/new-book.pdf";
        let bytes = b"fake-pdf-bytes";
        let fetcher = MockFetcher::default().with_bytes(key, bytes);

        handle_s3_add_with_fetcher(
            &fetcher,
            &s3_object(key, "etag-1", bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("add should succeed");

        let book = db
            .find_by_path(key)
            .expect("query by path")
            .expect("book should exist");
        assert_eq!(book.file_type, "pdf");
        assert_eq!(book.title, "new-book");

        let s3_books = db.find_s3_books("bucket-a").expect("query s3 books");
        assert_eq!(s3_books.len(), 1);
        assert_eq!(s3_books[0].file_path, key);
        assert_eq!(s3_books[0].s3_etag.as_deref(), Some("etag-1"));
    }

    #[tokio::test]
    async fn handle_s3_add_skips_zero_byte_object() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key = "library/empty.pdf";
        let fetcher = MockFetcher::default().with_bytes(key, &[]);

        handle_s3_add_with_fetcher(
            &fetcher,
            &s3_object(key, "etag-empty", 0),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("zero-byte add should not error");

        assert!(db.find_by_path(key).expect("query by path").is_none());
        assert!(
            db.find_s3_books("bucket-a")
                .expect("query s3 books")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn handle_s3_add_propagates_fetch_errors() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key = "library/broken.pdf";
        let fetcher = MockFetcher::default().with_error(key, "simulated download failure");

        let result = handle_s3_add_with_fetcher(
            &fetcher,
            &s3_object(key, "etag-broken", 5),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await;

        let error_text = result
            .expect_err("fetch failure should bubble up")
            .to_string();
        assert!(error_text.contains("simulated download failure"));
        assert!(db.find_by_path(key).expect("query by path").is_none());
        assert!(
            db.find_s3_books("bucket-a")
                .expect("query s3 books")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn handle_s3_add_skips_duplicate_hash() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key_a = "library/book-a.pdf";
        let key_b = "library/book-b.pdf";
        let same_bytes = b"same-content";
        let fetcher = MockFetcher::default()
            .with_bytes(key_a, same_bytes)
            .with_bytes(key_b, same_bytes);

        handle_s3_add_with_fetcher(
            &fetcher,
            &s3_object(key_a, "etag-a", same_bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("first add should succeed");
        handle_s3_add_with_fetcher(
            &fetcher,
            &s3_object(key_b, "etag-b", same_bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("duplicate add should not error");

        assert!(db.find_by_path(key_a).expect("query key_a").is_some());
        assert!(db.find_by_path(key_b).expect("query key_b").is_none());
        assert_eq!(
            db.find_s3_books("bucket-a").expect("query s3 books").len(),
            1
        );
    }

    #[tokio::test]
    async fn handle_s3_change_missing_row_routes_to_add() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key = "library/missing.epub";
        let bytes = b"fake-epub-bytes";
        let fetcher = MockFetcher::default().with_bytes(key, bytes);

        handle_s3_change_with_fetcher(
            &fetcher,
            &s3_object(key, "etag-1", bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("change should route to add");

        let inserted = db.find_by_path(key).expect("query by path");
        assert!(inserted.is_some());
        let s3_books = db.find_s3_books("bucket-a").expect("query s3 books");
        assert_eq!(s3_books.len(), 1);
        assert_eq!(s3_books[0].s3_etag.as_deref(), Some("etag-1"));
    }

    #[tokio::test]
    async fn handle_s3_change_unchanged_hash_only_updates_etag() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key = "library/unchanged.pdf";
        let bytes = b"same-bytes";
        let fetcher = MockFetcher::default().with_bytes(key, bytes);

        handle_s3_add_with_fetcher(
            &fetcher,
            &s3_object(key, "etag-1", bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("initial add should succeed");
        let before = db
            .find_by_path(key)
            .expect("query before")
            .expect("book before");

        handle_s3_change_with_fetcher(
            &fetcher,
            &s3_object(key, "etag-2", bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("change should succeed");

        let after = db
            .find_by_path(key)
            .expect("query after")
            .expect("book after");
        assert_eq!(after.file_hash, before.file_hash);
        assert_eq!(after.title, before.title);

        let s3_books = db.find_s3_books("bucket-a").expect("query s3 books");
        assert_eq!(s3_books[0].s3_etag.as_deref(), Some("etag-2"));
    }

    #[tokio::test]
    async fn handle_s3_change_changed_hash_updates_book() {
        let db = Database::open_in_memory().expect("in-memory db");
        let covers_dir = tempdir().expect("covers tempdir");
        let key = "library/changed.pdf";
        let original_bytes = b"original-content";
        let updated_bytes = b"updated-content";
        let fetcher_initial = MockFetcher::default().with_bytes(key, original_bytes);
        let fetcher_updated = MockFetcher::default().with_bytes(key, updated_bytes);

        handle_s3_add_with_fetcher(
            &fetcher_initial,
            &s3_object(key, "etag-1", original_bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("initial add should succeed");
        let before = db
            .find_by_path(key)
            .expect("query before")
            .expect("book before");

        handle_s3_change_with_fetcher(
            &fetcher_updated,
            &s3_object(key, "etag-2", updated_bytes.len() as u64),
            &db,
            "bucket-a",
            covers_dir.path(),
        )
        .await
        .expect("changed content update should succeed");

        let after = db
            .find_by_path(key)
            .expect("query after")
            .expect("book after");
        assert_ne!(after.file_hash, before.file_hash);

        let s3_books = db.find_s3_books("bucket-a").expect("query s3 books");
        assert_eq!(s3_books[0].s3_etag.as_deref(), Some("etag-2"));
    }

    #[test]
    fn handle_s3_delete_removes_row_and_increments_library_version() {
        let db = Database::open_in_memory().expect("in-memory db");
        let now = unix_now();
        let key = "library/delete-me.pdf";

        db.insert_book(&NewBook {
            id: "book-1",
            title: "Delete Me",
            author: None,
            description: None,
            file_type: "pdf",
            file_path: key,
            file_size: 11,
            file_hash: "hash-delete-me",
            cover_path: None,
            page_count: None,
            added_at: now,
            updated_at: now,
            source: "s3",
            s3_bucket: Some("bucket-a"),
            s3_etag: Some("etag-delete"),
        })
        .expect("insert seed book");
        assert!(
            db.get_library_version()
                .expect("query version before")
                .is_none()
        );

        let book = db
            .find_s3_books("bucket-a")
            .expect("query s3 books")
            .into_iter()
            .find(|row| row.file_path == key)
            .expect("book row for delete");

        handle_s3_delete(&db, &book).expect("delete should succeed");

        assert!(db.find_by_path(key).expect("query by path").is_none());
        assert!(
            db.get_library_version()
                .expect("query version after")
                .is_some()
        );
    }
}
