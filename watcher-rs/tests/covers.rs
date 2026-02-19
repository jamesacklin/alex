use image::ImageReader;
use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::TempDir;
use watcher_rs::covers::{
    epub::extract_epub_cover, generate_epub_cover, generate_fallback_cover, generate_pdf_cover,
    render_pdf_cover_primary,
};

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

xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000062 00000 n
0000000115 00000 n

trailer
<< /Size 4 /Root 1 0 R >>
startxref
170
%%EOF";
    fs::write(path, pdf).unwrap();
}

fn create_corrupt_pdf(path: &Path) {
    fs::write(path, b"not a pdf").unwrap();
}

fn create_epub_with_cover(path: &Path) {
    let mut png_bytes = Vec::new();
    let image = image::RgbImage::from_fn(32, 32, |_, _| image::Rgb([200, 20, 20]));
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .unwrap();

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
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    )
    .unwrap();

    zip.start_file("OPS/content.opf", options).unwrap();
    zip.write_all(
        br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Covered EPUB</dc:title>
    <meta name="cover" content="cover-image-id"/>
  </metadata>
  <manifest>
    <item id="cover-image-id" href="images/cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine/>
</package>"#,
    )
    .unwrap();

    zip.start_file("OPS/images/cover.png", options).unwrap();
    zip.write_all(&png_bytes).unwrap();

    zip.finish().unwrap();
}

fn create_epub_without_cover(path: &Path) {
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
    <dc:title>No Cover EPUB</dc:title>
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
    zip.write_all(b"<html><body><p>Hello</p></body></html>")
        .unwrap();

    zip.finish().unwrap();
}

#[test]
fn test_pdf_render_primary_generates_jpeg_with_dimensions() {
    let tmp = TempDir::new().unwrap();
    let pdf_path = tmp.path().join("ok.pdf");
    let covers_dir = tmp.path().join("covers");
    create_sample_pdf(&pdf_path);

    let cover = render_pdf_cover_primary(&pdf_path, "book-1", &covers_dir);
    assert!(cover.is_some());

    let cover = cover.unwrap();
    assert!(cover.exists());

    let img = ImageReader::open(&cover).unwrap().decode().unwrap();
    assert!(img.width() > 0);
    assert!(img.height() > 0);
}

#[test]
fn test_epub_cover_extraction_generates_jpeg() {
    let tmp = TempDir::new().unwrap();
    let epub_path = tmp.path().join("covered.epub");
    let covers_dir = tmp.path().join("covers");
    create_epub_with_cover(&epub_path);

    let cover = extract_epub_cover(&epub_path, "book-2", &covers_dir);
    assert!(cover.is_some());

    let cover = cover.unwrap();
    assert!(cover.exists());

    let img = ImageReader::open(&cover).unwrap().decode().unwrap();
    assert!(img.width() > 0);
    assert!(img.height() > 0);
}

#[test]
fn test_epub_without_cover_returns_none_and_writes_nothing() {
    let tmp = TempDir::new().unwrap();
    let epub_path = tmp.path().join("no-cover.epub");
    let covers_dir = tmp.path().join("covers");
    create_epub_without_cover(&epub_path);

    let cover = extract_epub_cover(&epub_path, "book-3", &covers_dir);
    assert!(cover.is_none());

    let expected = covers_dir.join("book-3.jpg");
    assert!(!expected.exists());
}

#[test]
fn test_fallback_cover_is_400x600_non_empty() {
    let tmp = TempDir::new().unwrap();
    let covers_dir = tmp.path().join("covers");

    let cover = generate_fallback_cover(
        "book-4",
        "A Very Long Title That Needs Wrapping Across Multiple Lines",
        Some("Author Name"),
        &covers_dir,
    );

    assert!(cover.is_some());

    let cover = cover.unwrap();
    let metadata = fs::metadata(&cover).unwrap();
    assert!(metadata.len() > 0);

    let img = ImageReader::open(&cover).unwrap().decode().unwrap();
    assert_eq!(img.width(), 400);
    assert_eq!(img.height(), 600);
}

#[test]
fn test_corrupt_pdf_falls_back_to_synthetic_cover() {
    let tmp = TempDir::new().unwrap();
    let pdf_path = tmp.path().join("broken.pdf");
    let covers_dir = tmp.path().join("covers");
    create_corrupt_pdf(&pdf_path);

    let cover = generate_pdf_cover(
        &pdf_path,
        "book-5",
        "Broken PDF",
        Some("Fallback Author"),
        &covers_dir,
    );

    assert!(cover.is_some());
    let cover = cover.unwrap();
    assert!(cover.exists());

    let img = ImageReader::open(&cover).unwrap().decode().unwrap();
    assert_eq!(img.width(), 400);
    assert_eq!(img.height(), 600);
}

#[test]
fn test_pdf_and_fallback_failure_returns_none() {
    let tmp = TempDir::new().unwrap();
    let pdf_path = tmp.path().join("broken.pdf");
    let fake_covers_dir = tmp.path().join("not-a-dir");
    create_corrupt_pdf(&pdf_path);
    fs::write(&fake_covers_dir, b"file").unwrap();

    let cover = generate_pdf_cover(&pdf_path, "book-6", "Bad", None, &fake_covers_dir);
    assert!(cover.is_none());
}

#[test]
fn test_generate_epub_cover_uses_fallback_when_no_embedded_cover() {
    let tmp = TempDir::new().unwrap();
    let epub_path = tmp.path().join("no-cover.epub");
    let covers_dir = tmp.path().join("covers");
    create_epub_without_cover(&epub_path);

    let cover = generate_epub_cover(
        &epub_path,
        "book-7",
        "No Cover EPUB",
        Some("Author"),
        &covers_dir,
    );

    assert!(cover.is_some());
}
