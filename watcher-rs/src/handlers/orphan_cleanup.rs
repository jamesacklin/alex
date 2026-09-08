use crate::db::Database;
use crate::log::log;
use anyhow::Result;
use std::path::Path;

/// Marker written inside the library root once it has been scanned.
///
/// Its presence is how we tell "the owner deleted their books" from "the
/// source is not currently mounted". A volume that is unmounted, or a
/// mountpoint that has been recreated as an empty directory, has no marker,
/// so the library root looks *unfamiliar* rather than empty.
const LIBRARY_MARKER: &str = ".alex-library";

/// What a scan concluded about the configured library root.
#[derive(Debug, PartialEq, Eq)]
pub enum SourceState {
    /// The root is present and is one we have scanned before.
    Available,
    /// The root does not exist at all.
    Missing,
    /// The root exists but is not the one we indexed (no marker), while the
    /// database still holds local books. Almost always an unmounted volume.
    Unrecognized,
}

/// Classify the library root before anything destructive is considered.
pub fn classify_source(library_root: &Path, has_local_books: bool) -> SourceState {
    if !library_root.is_dir() {
        return SourceState::Missing;
    }

    if library_root.join(LIBRARY_MARKER).exists() {
        return SourceState::Available;
    }

    // A brand-new (or newly chosen) empty folder is legitimately unfamiliar.
    // Only treat that as a problem when we have books that claim to live here.
    if has_local_books {
        SourceState::Unrecognized
    } else {
        SourceState::Available
    }
}

/// Record that this root is the one we index, so a later scan can recognise it.
pub fn mark_source_scanned(library_root: &Path) -> Result<()> {
    if !library_root.is_dir() {
        return Ok(());
    }

    let marker = library_root.join(LIBRARY_MARKER);
    if marker.exists() {
        return Ok(());
    }

    std::fs::write(
        &marker,
        "Alex uses this file to recognise the library folder it indexed.\n\
         Deleting it is harmless; Alex will simply be more cautious about\n\
         removing book records the next time it scans.\n",
    )?;

    Ok(())
}

/// Remove books from the DB whose local files no longer exist on disk.
///
/// Only checks books with source='local' (S3 orphan cleanup is handled by the
/// S3 scanner).
///
/// This used to treat `Path::exists() == false` as permission to delete the
/// book row and its cover, which meant an absent external volume — whose
/// mountpoint remains as an empty directory — read as "every book was
/// deleted". Because book deletion cascades to reading progress and
/// collection membership, and re-indexing cannot reconstruct either, a
/// temporary outage destroyed durable reader state (F09).
///
/// Deletion now requires positive evidence that the file is gone rather than
/// merely unreachable:
///
///   - the library root must be present and recognised, and
///   - the book's own parent directory must be present.
pub fn remove_orphaned_books(db: &Database, library_root: &Path) -> Result<()> {
    let all_books = db.all_books()?;

    match classify_source(library_root, !all_books.is_empty()) {
        SourceState::Missing => {
            if !all_books.is_empty() {
                log(&format!(
                    "[SCAN] Library folder {} is not present; keeping {} book record(s) and \
                     skipping orphan cleanup.",
                    library_root.display(),
                    all_books.len()
                ));
            }
            return Ok(());
        }
        SourceState::Unrecognized => {
            log(&format!(
                "[SCAN] Library folder {} does not look like the one we indexed (no {} marker) \
                 but {} book record(s) reference it. Treating the source as unavailable and \
                 skipping orphan cleanup.",
                library_root.display(),
                LIBRARY_MARKER,
                all_books.len()
            ));
            return Ok(());
        }
        SourceState::Available => {}
    }

    let mut removed = 0u32;
    let mut skipped_unavailable = 0u32;

    for book in &all_books {
        let file_path = Path::new(&book.file_path);
        if file_path.exists() {
            continue;
        }

        // If the containing directory is gone too, we cannot tell deletion
        // from an unmounted subtree. Leave the record alone.
        match file_path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() && !parent.is_dir() => {
                skipped_unavailable += 1;
                continue;
            }
            _ => {}
        }

        if let Some(ref cover_path) = book.cover_path {
            let _ = std::fs::remove_file(cover_path);
        }
        db.delete_book(&book.id)?;
        log(&format!("[SCAN] Removed orphan: \"{}\"", book.title));
        removed += 1;
    }

    if removed > 0 {
        log(&format!(
            "[SCAN] Cleaned up {} orphaned entry(ies).",
            removed
        ));
    }

    if skipped_unavailable > 0 {
        log(&format!(
            "[SCAN] Kept {} book record(s) whose folder is currently unreachable.",
            skipped_unavailable
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn a_missing_root_is_missing() {
        let dir = tempdir().unwrap();
        let absent = dir.path().join("not-here");
        assert_eq!(classify_source(&absent, true), SourceState::Missing);
        assert_eq!(classify_source(&absent, false), SourceState::Missing);
    }

    #[test]
    fn an_empty_root_with_indexed_books_is_unrecognized() {
        let dir = tempdir().unwrap();
        assert_eq!(classify_source(dir.path(), true), SourceState::Unrecognized);
    }

    #[test]
    fn an_empty_root_with_no_indexed_books_is_available() {
        let dir = tempdir().unwrap();
        assert_eq!(classify_source(dir.path(), false), SourceState::Available);
    }

    #[test]
    fn a_marked_root_is_available_even_when_empty() {
        let dir = tempdir().unwrap();
        mark_source_scanned(dir.path()).unwrap();
        assert_eq!(classify_source(dir.path(), true), SourceState::Available);
    }

    #[test]
    fn marking_is_idempotent() {
        let dir = tempdir().unwrap();
        mark_source_scanned(dir.path()).unwrap();
        let first = std::fs::read(dir.path().join(LIBRARY_MARKER)).unwrap();
        mark_source_scanned(dir.path()).unwrap();
        let second = std::fs::read(dir.path().join(LIBRARY_MARKER)).unwrap();
        assert_eq!(first, second);
    }
}
