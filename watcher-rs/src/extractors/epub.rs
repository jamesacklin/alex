use super::BookMetadata;
use quick_xml::Reader;
use quick_xml::events::Event;
use std::io::Read;
use std::path::Path;

pub fn extract_epub_metadata(file_path: &Path) -> BookMetadata {
    let fallback_title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    match try_extract(file_path, &fallback_title) {
        Ok(meta) => meta,
        Err(_) => BookMetadata {
            title: fallback_title,
            author: None,
            description: None,
            page_count: None,
            cover_path: None,
        },
    }
}

pub fn extract_epub_metadata_from_bytes(bytes: &[u8], fallback_title: &str) -> BookMetadata {
    match try_extract_from_bytes(bytes, fallback_title) {
        Ok(meta) => meta,
        Err(_) => BookMetadata {
            title: fallback_title.to_string(),
            author: None,
            description: None,
            page_count: None,
            cover_path: None,
        },
    }
}

fn try_extract(file_path: &Path, fallback_title: &str) -> anyhow::Result<BookMetadata> {
    let file = std::fs::File::open(file_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    try_extract_from_archive(&mut archive, fallback_title)
}

fn try_extract_from_bytes(bytes: &[u8], fallback_title: &str) -> anyhow::Result<BookMetadata> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;
    try_extract_from_archive(&mut archive, fallback_title)
}

fn try_extract_from_archive<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    fallback_title: &str,
) -> anyhow::Result<BookMetadata> {
    let opf_path = parse_container_xml(archive)?;
    let (title, author, description) = parse_opf(archive, &opf_path)?;

    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| fallback_title.to_string());

    Ok(BookMetadata {
        title,
        author,
        description,
        page_count: None,
        cover_path: None,
    })
}

fn parse_container_xml<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> anyhow::Result<String> {
    let mut container = archive.by_name("META-INF/container.xml")?;
    let mut xml = String::new();
    container.read_to_string(&mut xml)?;

    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                let local_name = e.local_name();
                if local_name.as_ref() == b"rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.local_name().as_ref() == b"full-path" {
                            return Ok(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.into()),
            _ => {}
        }
        buf.clear();
    }

    anyhow::bail!("No rootfile found in container.xml")
}

fn parse_opf<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    opf_path: &str,
) -> anyhow::Result<(Option<String>, Option<String>, Option<String>)> {
    let mut opf_file = archive.by_name(opf_path)?;
    let mut xml = String::new();
    opf_file.read_to_string(&mut xml)?;

    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();

    let mut title: Option<String> = None;
    let mut author: Option<String> = None;
    let mut description: Option<String> = None;

    let mut current_element: Option<&'static str> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                match local.as_ref() {
                    b"title" => current_element = Some("title"),
                    b"creator" => current_element = Some("creator"),
                    b"description" => current_element = Some("description"),
                    _ => current_element = None,
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Some(el) = current_element {
                    let text = e.unescape().unwrap_or_default().trim().to_string();
                    if !text.is_empty() {
                        match el {
                            "title" if title.is_none() => title = Some(text),
                            "creator" if author.is_none() => author = Some(text),
                            "description" if description.is_none() => description = Some(text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(_)) => {
                current_element = None;
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.into()),
            _ => {}
        }
        buf.clear();
    }

    Ok((title, author, description))
}
