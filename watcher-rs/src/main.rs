use clap::Parser;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use watcher_rs::db::Database;

#[derive(Parser)]
#[command(
    name = "watcher-rs",
    about = "Watch a library directory for PDF and EPUB files"
)]
struct Args {
    #[arg(long, env = "LIBRARY_PATH", default_value = "./data/library")]
    library_path: String,

    #[arg(long, env = "DATABASE_PATH", default_value = "./data/library.db")]
    db_path: String,

    #[arg(long, env = "COVERS_PATH", default_value = "./data/covers")]
    covers_path: String,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Ensure library directory exists
    std::fs::create_dir_all(&args.library_path)?;
    std::fs::create_dir_all(&args.covers_path)?;

    // Resolve to absolute path
    let library_path = std::fs::canonicalize(&args.library_path)?;
    let covers_path = std::fs::canonicalize(&args.covers_path)?;

    // Open database
    let db = Database::open(&args.db_path)?;

    // Set up shutdown signal
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_flag = Arc::clone(&shutdown);
    ctrlc::set_handler(move || {
        shutdown_flag.store(true, Ordering::Relaxed);
    })?;

    // Run the watcher (blocks until shutdown)
    watcher_rs::watcher::run(library_path, covers_path, db, shutdown)?;

    Ok(())
}
