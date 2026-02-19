use crate::db::{unix_now, Database, NewBook};
use crate::extractors::epub::extract_epub_metadata;
use crate::extractors::pdf::extract_pdf_metadata;
use crate::log::log;
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io;
use std::path::Path;

pub fn compute_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn handle_add(db: &Database, file_path: &Path) -> Result<()> {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let file_type = if ext == "pdf" { "pdf" } else { "epub" };

    let meta = std::fs::metadata(file_path)?;
    if meta.len() == 0 {
        log(&format!(
            "[SKIP] Zero-byte file (waiting for write): {}",
            file_path.display()
        ));
        return Ok(());
    }

    let file_hash = compute_sha256(file_path)?;

    if let Some(existing_title) = db.find_by_hash(&file_hash)? {
        log(&format!(
            "[SKIP] Duplicate (matches \"{}\"): {}",
            existing_title,
            file_path.display()
        ));
        return Ok(());
    }

    let book_id = uuid::Uuid::new_v4().to_string();

    let metadata = if file_type == "pdf" {
        extract_pdf_metadata(file_path)
    } else {
        extract_epub_metadata(file_path)
    };

    let now = unix_now();
    let file_path_str = file_path.to_string_lossy();

    let changes = db.insert_book(&NewBook {
        id: &book_id,
        title: &metadata.title,
        author: metadata.author.as_deref(),
        description: metadata.description.as_deref(),
        file_type,
        file_path: &file_path_str,
        file_size: meta.len() as i64,
        file_hash: &file_hash,
        cover_path: metadata.cover_path.as_deref(),
        page_count: metadata.page_count.map(|p| p as i64),
        added_at: now,
        updated_at: now,
    })?;

    if changes == 0 {
        log(&format!("[SKIP] Already exists: {}", file_path.display()));
        return Ok(());
    }

    log(&format!(
        "[OK] Added \"{}\" ({})",
        metadata.title, file_type
    ));
    db.increment_library_version()?;
    Ok(())
}
