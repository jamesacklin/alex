use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::TempDir;
use watcher_rs::db::Database;
use watcher_rs::handlers::{
    handle_add_with_covers_dir, handle_change_with_covers_dir, handle_delete,
    mark_source_scanned, remove_orphaned_books,
};

fn create_test_db() -> (TempDir, Database) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let db = Database::open(db_path.to_str().unwrap()).unwrap();
    db.create_test_schema();
    (dir, db)
}

fn create_covers_dir() -> TempDir {
    TempDir::new().unwrap()
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

    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

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
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();

    let book = db.find_by_path(pdf_path.to_str().unwrap()).unwrap();
    assert!(book.is_some());
    let book = book.unwrap();
    assert_eq!(book.file_type, "pdf");
    assert!(!book.title.is_empty());
    assert!(book.cover_path.is_some());
}

#[test]
fn test_add_epub() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let epub_path = lib_dir.path().join("book.epub");
    create_sample_epub(&epub_path);

    handle_add_with_covers_dir(&db, &epub_path, covers_dir.path()).unwrap();

    let book = db.find_by_path(epub_path.to_str().unwrap()).unwrap();
    assert!(book.is_some());
    let book = book.unwrap();
    assert_eq!(book.file_type, "epub");
    assert_eq!(book.title, "Test EPUB Book");
    assert!(book.cover_path.is_some());
}

#[test]
fn test_duplicate_hash_skipped() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();

    let pdf1 = lib_dir.path().join("book1.pdf");
    let pdf2 = lib_dir.path().join("book2.pdf");
    create_sample_pdf(&pdf1);
    fs::copy(&pdf1, &pdf2).unwrap();

    handle_add_with_covers_dir(&db, &pdf1, covers_dir.path()).unwrap();
    handle_add_with_covers_dir(&db, &pdf2, covers_dir.path()).unwrap();

    let all = db.all_books().unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn test_zero_byte_skipped() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("empty.pdf");
    fs::write(&pdf_path, b"").unwrap();

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();

    let all = db.all_books().unwrap();
    assert_eq!(all.len(), 0);
}

#[test]
fn test_handle_delete() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();
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
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 1);

    // The library root is the one we indexed, so a file that disappears from
    // it really has been deleted.
    mark_source_scanned(lib_dir.path()).unwrap();
    fs::remove_file(&pdf_path).unwrap();

    remove_orphaned_books(&db, lib_dir.path()).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 0);
}

/// F09: an absent library root must not be read as "every book was deleted".
#[test]
fn test_orphan_cleanup_keeps_books_when_the_source_is_missing() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();
    mark_source_scanned(lib_dir.path()).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 1);

    // Simulate the volume going away entirely.
    let missing_root = lib_dir.path().join("not-mounted");
    fs::remove_file(&pdf_path).unwrap();

    remove_orphaned_books(&db, &missing_root).unwrap();
    assert_eq!(
        db.all_books().unwrap().len(),
        1,
        "an unreachable source must not delete book records"
    );
}

/// F09: an empty directory where the volume used to be mounted is the exact
/// shape the previous implementation mistook for deletion.
#[test]
fn test_orphan_cleanup_keeps_books_when_the_mountpoint_is_empty() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 1);

    // The mountpoint is present but empty and carries no marker: the volume
    // is not mounted, not wiped.
    let empty_mountpoint = TempDir::new().unwrap();

    remove_orphaned_books(&db, empty_mountpoint.path()).unwrap();
    assert_eq!(
        db.all_books().unwrap().len(),
        1,
        "an unrecognised source must not delete book records"
    );

    // And once the volume is back, cleanup behaves normally again.
    mark_source_scanned(lib_dir.path()).unwrap();
    fs::remove_file(&pdf_path).unwrap();
    remove_orphaned_books(&db, lib_dir.path()).unwrap();
    assert_eq!(db.all_books().unwrap().len(), 0);
}

/// F09: narrowing the configured prefix must not make objects outside it
/// look removed.
#[test]
fn test_s3_reconciliation_is_scoped_to_the_prefix() {
    let (_db_dir, db) = create_test_db();
    let now = 1_700_000_000;

    for (id, key) in [("a", "fiction/one.epub"), ("b", "reference/two.pdf")] {
        db.insert_book(&watcher_rs::db::NewBook {
            id,
            title: key,
            author: None,
            description: None,
            file_type: if key.ends_with(".epub") { "epub" } else { "pdf" },
            file_path: key,
            file_size: 10,
            file_hash: id,
            cover_path: None,
            page_count: None,
            added_at: now,
            updated_at: now,
            source: "s3",
            s3_bucket: Some("bucket-a"),
            s3_etag: Some("etag"),
        })
        .unwrap();
    }

    // The whole bucket.
    assert_eq!(db.find_s3_books("bucket-a", None).unwrap().len(), 2);

    // Narrowed to one prefix: only that prefix's rows are in scope, so the
    // diff cannot classify the others as removed.
    let scoped = db.find_s3_books("bucket-a", Some("fiction/")).unwrap();
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].file_path, "fiction/one.epub");
}

#[test]
fn test_library_version_incremented() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();

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
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();

    let mut content = fs::read(&pdf_path).unwrap();
    content.extend_from_slice(b"\n% modified");
    fs::write(&pdf_path, &content).unwrap();

    handle_change_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();

    let all = db.all_books().unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn test_handle_change_hash_unchanged() {
    let (_db_dir, db) = create_test_db();
    let covers_dir = create_covers_dir();
    let lib_dir = TempDir::new().unwrap();
    let pdf_path = lib_dir.path().join("book.pdf");
    create_sample_pdf(&pdf_path);

    handle_add_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();
    let book_before = db
        .find_by_path(pdf_path.to_str().unwrap())
        .unwrap()
        .unwrap();

    handle_change_with_covers_dir(&db, &pdf_path, covers_dir.path()).unwrap();

    let book_after = db
        .find_by_path(pdf_path.to_str().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(book_before.file_hash, book_after.file_hash);
    assert_eq!(book_before.title, book_after.title);
}
