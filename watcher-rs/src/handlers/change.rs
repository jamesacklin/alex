use crate::covers::{default_covers_dir, generate_epub_cover, generate_pdf_cover};
use crate::db::{Database, UpdateBook, unix_now};
use crate::extractors::epub::extract_epub_metadata;
use crate::extractors::pdf::extract_pdf_metadata;
use crate::handlers::add::{compute_sha256, handle_add_with_covers_dir};
use crate::log::log;
use anyhow::Result;
use std::path::Path;

pub fn handle_change(db: &Database, file_path: &Path) -> Result<()> {
    let covers_dir = default_covers_dir();
    handle_change_with_covers_dir(db, file_path, &covers_dir)
}

pub fn handle_change_with_covers_dir(
    db: &Database,
    file_path: &Path,
    covers_dir: &Path,
) -> Result<()> {
    let file_path_str = file_path.to_string_lossy();

    let book = match db.find_by_path(&file_path_str)? {
        Some(b) => b,
        None => {
            log(&format!(
                "[INFO] Change detected for untracked file; attempting add: {}",
                file_path.display()
            ));
            return handle_add_with_covers_dir(db, file_path, covers_dir);
        }
    };

    let meta = std::fs::metadata(file_path)?;
    if meta.len() == 0 {
        log(&format!(
            "[SKIP] Zero-byte file during change (waiting for write): {}",
            file_path.display()
        ));
        return Ok(());
    }

    let new_hash = compute_sha256(file_path)?;
    if new_hash == book.file_hash {
        log(&format!("[SKIP] Hash unchanged for \"{}\"", book.title));
        return Ok(());
    }

    let metadata = if book.file_type == "pdf" {
        extract_pdf_metadata(file_path)
    } else {
        extract_epub_metadata(file_path)
    };
    let cover_path = if book.file_type == "pdf" {
        generate_pdf_cover(
            file_path,
            &book.id,
            &metadata.title,
            metadata.author.as_deref(),
            covers_dir,
        )
    } else {
        generate_epub_cover(
            file_path,
            &book.id,
            &metadata.title,
            metadata.author.as_deref(),
            covers_dir,
        )
    };
    let cover_path_str = cover_path.as_ref().and_then(|p| p.to_str());

    // If old cover exists but new generation produced none, remove stale cover file.
    if let Some(ref old_cover) = book.cover_path {
        let should_delete_old = match cover_path.as_ref() {
            Some(new_cover) => new_cover.to_string_lossy() != old_cover.as_str(),
            None => true,
        };
        if should_delete_old {
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
            file_size: meta.len() as i64,
            file_hash: &new_hash,
            cover_path: cover_path_str,
            page_count: metadata.page_count.map(|p| p as i64),
            updated_at: now,
            s3_etag: None,
        },
    )?;

    log(&format!(
        "[UPDATE] \"{}\" -> \"{}\" ({})",
        book.title, metadata.title, book.file_type
    ));
    db.increment_library_version()?;
    Ok(())
}
