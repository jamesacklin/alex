use crate::db::Database;
use crate::log::log;
use anyhow::Result;
use std::path::Path;

pub fn handle_delete(db: &Database, file_path: &Path) -> Result<()> {
    let file_path_str = file_path.to_string_lossy();

    let book = match db.find_by_path(&file_path_str)? {
        Some(b) => b,
        None => {
            log(&format!(
                "[WARN] No DB record for deleted file: {}",
                file_path.display()
            ));
            return Ok(());
        }
    };

    if let Some(ref cover_path) = book.cover_path {
        let _ = std::fs::remove_file(cover_path);
    }

    db.delete_book(&book.id)?;

    log(&format!("[DELETE] Removed \"{}\" from library", book.title));
    db.increment_library_version()?;
    Ok(())
}
