pub mod epub;
mod fallback;
mod pdf;

use std::path::{Path, PathBuf};

pub fn default_covers_dir() -> PathBuf {
    std::env::var("COVERS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("data/covers"))
}

pub fn generate_pdf_cover(
    file_path: &Path,
    book_id: &str,
    title: &str,
    author: Option<&str>,
    covers_dir: &Path,
) -> Option<PathBuf> {
    pdf::render_pdf_cover(file_path, book_id, covers_dir)
        .or_else(|| fallback::generate_synthetic_cover(book_id, title, author, covers_dir))
}

pub fn generate_pdf_cover_from_bytes(
    bytes: &[u8],
    book_id: &str,
    title: &str,
    author: Option<&str>,
    covers_dir: &Path,
) -> Option<PathBuf> {
    pdf::render_pdf_cover_from_bytes(bytes, book_id, covers_dir)
        .or_else(|| fallback::generate_synthetic_cover(book_id, title, author, covers_dir))
}

pub fn render_pdf_cover_primary(
    file_path: &Path,
    book_id: &str,
    covers_dir: &Path,
) -> Option<PathBuf> {
    pdf::render_pdf_cover(file_path, book_id, covers_dir)
}

pub fn generate_epub_cover(
    file_path: &Path,
    book_id: &str,
    title: &str,
    author: Option<&str>,
    covers_dir: &Path,
) -> Option<PathBuf> {
    epub::extract_epub_cover(file_path, book_id, covers_dir)
        .or_else(|| fallback::generate_synthetic_cover(book_id, title, author, covers_dir))
}

pub fn generate_epub_cover_from_bytes(
    bytes: &[u8],
    book_id: &str,
    title: &str,
    author: Option<&str>,
    covers_dir: &Path,
) -> Option<PathBuf> {
    epub::extract_epub_cover_from_bytes(bytes, book_id, covers_dir)
        .or_else(|| fallback::generate_synthetic_cover(book_id, title, author, covers_dir))
}

pub fn generate_fallback_cover(
    book_id: &str,
    title: &str,
    author: Option<&str>,
    covers_dir: &Path,
) -> Option<PathBuf> {
    fallback::generate_synthetic_cover(book_id, title, author, covers_dir)
}
