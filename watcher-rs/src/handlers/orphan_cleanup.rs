use crate::db::Database;
use crate::log::log;
use anyhow::Result;
use std::path::Path;

pub fn remove_orphaned_books(db: &Database) -> Result<()> {
    let all_books = db.all_books()?;
    let mut removed = 0u32;

    for book in &all_books {
        if !Path::new(&book.file_path).exists() {
            if let Some(ref cover_path) = book.cover_path {
                let _ = std::fs::remove_file(cover_path);
            }
            db.delete_book(&book.id)?;
            log(&format!("[SCAN] Removed orphan: \"{}\"", book.title));
            removed += 1;
        }
    }

    if removed > 0 {
        log(&format!(
            "[SCAN] Cleaned up {} orphaned entry(ies).",
            removed
        ));
    }

    Ok(())
}
