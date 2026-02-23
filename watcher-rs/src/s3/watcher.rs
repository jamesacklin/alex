use anyhow::Result;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::S3Config;
use super::client::create_bucket;
use super::handlers::{handle_s3_add, handle_s3_change, handle_s3_delete};
use super::scanner::{compute_diff, list_objects};
use crate::db::Database;
use crate::log::log;

/// Run the S3 polling watcher. Blocks until shutdown signal.
pub async fn run(
    config: S3Config,
    covers_path: &Path,
    db: Database,
    shutdown: Arc<AtomicBool>,
) -> Result<()> {
    let bucket = create_bucket(&config)?;
    let prefix = config.prefix.as_deref();

    log(&format!(
        "[S3] Watching s3://{}/{}  (poll every {}s)",
        config.bucket,
        prefix.unwrap_or(""),
        config.poll_interval
    ));

    // Initial scan
    log("[S3] Starting initial scan...");
    let scan_result =
        run_scan_cycle(&bucket, &config.bucket, prefix, covers_path, &db).await;
    match scan_result {
        Ok((added, changed, removed)) => {
            log(&format!(
                "[S3] Initial scan complete — {} added, {} updated, {} removed",
                added, changed, removed
            ));
        }
        Err(e) => {
            log(&format!("[S3] [ERROR] Initial scan failed: {}", e));
        }
    }

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        tokio::time::sleep(std::time::Duration::from_secs(config.poll_interval)).await;

        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        match run_scan_cycle(&bucket, &config.bucket, prefix, covers_path, &db).await {
            Ok((added, changed, removed)) => {
                if added + changed + removed > 0 {
                    log(&format!(
                        "[S3] Poll: {} added, {} updated, {} removed",
                        added, changed, removed
                    ));
                }
            }
            Err(e) => {
                log(&format!("[S3] [ERROR] Poll cycle failed: {}", e));
            }
        }
    }

    log("[S3] Shutting down...");
    Ok(())
}

/// Run a single scan cycle: list S3 → diff against DB → process changes.
/// Returns (added_count, changed_count, removed_count).
async fn run_scan_cycle(
    bucket: &s3::Bucket,
    bucket_name: &str,
    prefix: Option<&str>,
    covers_dir: &Path,
    db: &Database,
) -> Result<(usize, usize, usize)> {
    let s3_objects = list_objects(bucket, prefix).await?;
    let db_books = db.find_s3_books(bucket_name)?;
    let diff = compute_diff(&s3_objects, &db_books);

    let added = diff.added.len();
    let changed = diff.changed.len();
    let removed = diff.removed.len();

    for object in &diff.added {
        if let Err(e) = handle_s3_add(bucket, object, db, bucket_name, covers_dir).await {
            log(&format!(
                "[S3] [ERROR] Failed to add {}: {}",
                object.key, e
            ));
        }
    }

    for object in &diff.changed {
        if let Err(e) = handle_s3_change(bucket, object, db, bucket_name, covers_dir).await {
            log(&format!(
                "[S3] [ERROR] Failed to update {}: {}",
                object.key, e
            ));
        }
    }

    for book in &diff.removed {
        if let Err(e) = handle_s3_delete(db, book) {
            log(&format!(
                "[S3] [ERROR] Failed to remove \"{}\": {}",
                book.title, e
            ));
        }
    }

    Ok((added, changed, removed))
}
