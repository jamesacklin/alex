use anyhow::{Context, Result};
use s3::Bucket;
use sha2::{Digest, Sha256};
use std::path::Path;

use super::scanner::{title_from_key, S3Object};
use crate::covers::{generate_epub_cover_from_bytes, generate_pdf_cover_from_bytes};
use crate::db::{Database, NewBook, UpdateBook, unix_now};
use crate::log::log;

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
    let file_type = file_type_from_key(&object.key);
    let fallback_title = title_from_key(&object.key);

    let bytes = fetch_object_bytes(bucket, &object.key).await?;
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
    let book = match db.find_by_path(&object.key)? {
        Some(b) => b,
        None => {
            log(&format!(
                "[S3] [INFO] Change for untracked key; adding: {}",
                object.key
            ));
            return handle_s3_add(bucket, object, db, bucket_name, covers_dir).await;
        }
    };

    let bytes = fetch_object_bytes(bucket, &object.key).await?;
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
