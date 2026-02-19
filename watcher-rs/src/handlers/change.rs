use crate::db::{unix_now, Database, UpdateBook};
use crate::extractors::epub::extract_epub_metadata;
use crate::extractors::pdf::extract_pdf_metadata;
use crate::handlers::add::{compute_sha256, handle_add};
use crate::log::log;
use anyhow::Result;
use std::path::Path;

pub fn handle_change(db: &Database, file_path: &Path) -> Result<()> {
    let file_path_str = file_path.to_string_lossy();

    let book = match db.find_by_path(&file_path_str)? {
        Some(b) => b,
        None => {
            log(&format!(
                "[INFO] Change detected for untracked file; attempting add: {}",
                file_path.display()
            ));
            return handle_add(db, file_path);
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
        log(&format!(
            "[SKIP] Hash unchanged for \"{}\"",
            book.title
        ));
        return Ok(());
    }

    let metadata = if book.file_type == "pdf" {
        extract_pdf_metadata(file_path)
    } else {
        extract_epub_metadata(file_path)
    };

    // If old cover exists but new extraction produced none, remove stale cover file
    if book.cover_path.is_some() && metadata.cover_path.is_none() {
        if let Some(ref cover) = book.cover_path {
            let _ = std::fs::remove_file(cover);
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
            cover_path: metadata.cover_path.as_deref(),
            page_count: metadata.page_count.map(|p| p as i64),
            updated_at: now,
        },
    )?;

    log(&format!(
        "[UPDATE] \"{}\" -> \"{}\" ({})",
        book.title, metadata.title, book.file_type
    ));
    db.increment_library_version()?;
    Ok(())
}
