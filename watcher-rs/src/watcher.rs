use crate::db::Database;
use crate::handlers::{
    handle_add_with_covers_dir, handle_change_with_covers_dir, handle_delete, remove_orphaned_books,
};
use crate::log::log;
use notify::{EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
enum PendingKind {
    AddOrModify,
    Remove,
}

struct PendingEntry {
    last_event_time: Instant,
    last_known_size: u64,
    kind: PendingKind,
}

fn is_target(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_lowercase();
            lower == "pdf" || lower == "epub"
        })
        .unwrap_or(false)
}

fn collect_target_files(root: &Path, out: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if !root.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            collect_target_files(&path, out)?;
            continue;
        }

        if file_type.is_file() && is_target(&path) {
            out.push(path);
        }
    }

    Ok(())
}

pub fn run(
    library_path: PathBuf,
    covers_path: PathBuf,
    db: Database,
    shutdown: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let (tx, rx) = mpsc::channel();

    let mut watcher = notify::recommended_watcher(move |res| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })?;

    watcher.watch(&library_path, RecursiveMode::Recursive)?;

    log(&format!(
        "Watching {} for .pdf and .epub files...",
        library_path.display()
    ));
    log("[SCAN] Starting initial library scan...");

    let mut pending: HashMap<PathBuf, PendingEntry> = HashMap::new();
    let mut scan_count: u64 = 0;
    let mut initial_scan_done = false;
    let stability_threshold = Duration::from_secs(2);
    let poll_interval = Duration::from_millis(500);

    let mut startup_files = Vec::new();
    collect_target_files(&library_path, &mut startup_files)?;
    for path in startup_files {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        pending.insert(
            path,
            PendingEntry {
                // Make startup files eligible immediately unless size changes.
                last_event_time: Instant::now() - stability_threshold,
                last_known_size: size,
                kind: PendingKind::AddOrModify,
            },
        );
    }

    if pending.is_empty() {
        initial_scan_done = true;
        log("[SCAN] Initial scan complete -- 0 file(s) found.");
        if let Err(e) = remove_orphaned_books(&db) {
            log(&format!("[ERROR] Orphan cleanup failed: {}", e));
        }
    }

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        match rx.recv_timeout(poll_interval) {
            Ok(event) => {
                let event: notify::Event = event;
                for path in &event.paths {
                    if !is_target(path) {
                        continue;
                    }

                    let kind = match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => PendingKind::AddOrModify,
                        EventKind::Remove(_) => PendingKind::Remove,
                        _ => continue,
                    };

                    let size = if kind == PendingKind::Remove {
                        0
                    } else {
                        std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
                    };

                    pending.insert(
                        path.clone(),
                        PendingEntry {
                            last_event_time: Instant::now(),
                            last_known_size: size,
                            kind,
                        },
                    );
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        // Dispatch entries that have been stable for the threshold duration
        let now = Instant::now();
        let mut to_dispatch: Vec<PathBuf> = Vec::new();

        for (path, entry) in pending.iter_mut() {
            if now.duration_since(entry.last_event_time) < stability_threshold {
                continue;
            }

            // For add/modify, re-check file size to detect ongoing writes
            if entry.kind == PendingKind::AddOrModify {
                let current_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                if current_size != entry.last_known_size {
                    entry.last_event_time = now;
                    entry.last_known_size = current_size;
                    continue;
                }
            }

            to_dispatch.push(path.clone());
        }

        for path in to_dispatch {
            let entry = pending.remove(&path).unwrap();

            match entry.kind {
                PendingKind::Remove => {
                    if let Err(e) = handle_delete(&db, &path) {
                        log(&format!(
                            "[ERROR] Failed to handle deletion of {}: {}",
                            path.display(),
                            e
                        ));
                    }
                }
                PendingKind::AddOrModify => {
                    if !initial_scan_done {
                        scan_count += 1;
                        if scan_count % 10 == 0 {
                            log(&format!("[SCAN] Processed {} files...", scan_count));
                        }
                    }

                    let file_path_str = path.to_string_lossy();
                    let is_existing = db.find_by_path(&file_path_str).ok().flatten().is_some();

                    if is_existing {
                        if let Err(e) = handle_change_with_covers_dir(&db, &path, &covers_path) {
                            log(&format!(
                                "[ERROR] Failed to process change for {}: {}",
                                path.display(),
                                e
                            ));
                        }
                    } else if let Err(e) = handle_add_with_covers_dir(&db, &path, &covers_path) {
                        log(&format!(
                            "[ERROR] Failed to process {}: {}",
                            path.display(),
                            e
                        ));
                    }
                }
            }
        }

        // Detect initial scan completion: pending map empties after processing files
        if !initial_scan_done && pending.is_empty() && scan_count > 0 {
            initial_scan_done = true;
            log(&format!(
                "[SCAN] Initial scan complete -- {} file(s) found.",
                scan_count
            ));
            if let Err(e) = remove_orphaned_books(&db) {
                log(&format!("[ERROR] Orphan cleanup failed: {}", e));
            }
        }
    }

    log("Shutting down...");
    drop(watcher);
    log("Watcher closed.");
    Ok(())
}
