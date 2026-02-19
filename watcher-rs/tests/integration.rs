use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::TempDir;
use watcher_rs::db::Database;
use watcher_rs::handlers::{handle_add, handle_change, handle_delete, remove_orphaned_books};

fn create_test_db() -> (TempDir, Database) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let db = Database::open(db_path.to_str().unwrap()).unwrap();
    db.create_test_schema();
    (dir, db)
}

/// Create a minimal valid PDF with Title and Author in the Info dictionary.
fn create_sample_pdf(path: &Path) {
    let pdf = b"%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj

4 0 obj
<< /Title (Test PDF Book) /Author (Jane Author) >>
endobj

xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000062 00000 n
0000000115 00000 n
0000000190 00000 n

trailer
<< /Size 5 /Root 1 0 R /Info 4 0 R >>
startxref
258
%%EOF";
    fs::write(path, pdf).unwrap();
}

/// Create a minimal valid EPUB with metadata.
fn create_sample_epub(path: &Path) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);

    zip.start_file("mimetype", options).unwrap();
    zip.write_all(b"application/epub+zip").unwrap();

    zip.start_file("META-INF/container.xml", options).unwrap();
    zip.write_all(
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    )
    .unwrap();

    zip.start_file("content.opf", options).unwrap();
    zip.write_all(
        br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test EPUB Book</dc:title>
    <dc:creator>John Writer</dc:creator>
    <dc:description>A test EPUB for integration testing.</dc:description>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>"#,
    )
    .unwrap();

    zip.start_file("chapter1.xhtml", options).unwrap();
    zip.write_all(
        br#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body><p>Hello</p></body>
</html>"#,
    )
    .unwrap();

    zip.finish().unwrap();
}

#[test]
fn test_add_pdf() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add(&db, &pdf_path).unwrap();

    let book = db.find_by_path(pdf_path.to_str().unwrap()).unwrap();
    assert!(book.is_some());
    let book = book.unwrap();
    assert_eq!(book.file_type, "pdf");
    assert_eq!(book.title, "Test PDF Book");
}

#[test]
fn test_add_epub() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let epub_path = lib_dir.path().join("book.epub");
    create_sample_epub(&epub_path);

    handle_add(&db, &epub_path).unwrap();

    let book = db.find_by_path(epub_path.to_str().unwrap()).unwrap();
    assert!(book.is_some());
    let book = book.unwrap();
    assert_eq!(book.file_type, "epub");
    assert_eq!(book.title, "Test EPUB Book");
}

#[test]
fn test_duplicate_hash_skipped() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();

    let pdf1 = lib_dir.path().join("book1.pdf");
    let pdf2 = lib_dir.path().join("book2.pdf");
    create_sample_pdf(&pdf1);
    fs::copy(&pdf1, &pdf2).unwrap();

    handle_add(&db, &pdf1).unwrap();
    handle_add(&db, &pdf2).unwrap();

    let all = db.all_books().unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn test_zero_byte_skipped() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("empty.pdf");
    fs::write(&pdf_path, b"").unwrap();

    handle_add(&db, &pdf_path).unwrap();

    let all = db.all_books().unwrap();
    assert_eq!(all.len(), 0);
}

#[test]
fn test_handle_delete() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add(&db, &pdf_path).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 1);

    handle_delete(&db, &pdf_path).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 0);
}

#[test]
fn test_delete_unknown_file() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let fake_path = lib_dir.path().join("nonexistent.pdf");

    handle_delete(&db, &fake_path).unwrap();
}

#[test]
fn test_orphan_cleanup() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add(&db, &pdf_path).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 1);

    fs::remove_file(&pdf_path).unwrap();

    remove_orphaned_books(&db).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 0);
}

#[test]
fn test_library_version_incremented() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add(&db, &pdf_path).unwrap();

    let version = db.get_library_version().unwrap();
    assert!(version.is_some());
    let v1 = version.unwrap();
    assert!(v1 > 0);

    handle_delete(&db, &pdf_path).unwrap();
    let v2 = db.get_library_version().unwrap().unwrap();
    assert!(v2 >= v1);
}

#[test]
fn test_handle_change_updates_metadata() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add(&db, &pdf_path).unwrap();

    let mut content = fs::read(&pdf_path).unwrap();
    content.extend_from_slice(b"\n% modified");
    fs::write(&pdf_path, &content).unwrap();

    handle_change(&db, &pdf_path).unwrap();

    let all = db.all_books().unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn test_handle_change_hash_unchanged() {
    let (_db_dir, db) = create_test_db();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add(&db, &pdf_path).unwrap();
    let book_before = db.find_by_path(pdf_path.to_str().unwrap()).unwrap().unwrap();

    handle_change(&db, &pdf_path).unwrap();

    let book_after = db.find_by_path(pdf_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(book_before.file_hash, book_after.file_hash);
    assert_eq!(book_before.title, book_after.title);
}
