use super::BookMetadata;
use std::path::Path;

pub fn extract_pdf_metadata(file_path: &Path) -> BookMetadata {
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

pub fn extract_pdf_metadata_from_bytes(bytes: &[u8], fallback_title: &str) -> BookMetadata {
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
    let doc = lopdf::Document::load(file_path)?;
    extract_from_doc(&doc, fallback_title)
}

fn try_extract_from_bytes(bytes: &[u8], fallback_title: &str) -> anyhow::Result<BookMetadata> {
    let doc = lopdf::Document::load_mem(bytes)?;
    extract_from_doc(&doc, fallback_title)
}

fn extract_from_doc(doc: &lopdf::Document, fallback_title: &str) -> anyhow::Result<BookMetadata> {
    let pages = doc.get_pages().len() as u32;
    let (title, author) = extract_info_dict(doc, fallback_title);

    Ok(BookMetadata {
        title,
        author,
        description: None,
        page_count: if pages > 0 { Some(pages) } else { None },
        cover_path: None,
    })
}

fn extract_info_dict(doc: &lopdf::Document, fallback_title: &str) -> (String, Option<String>) {
    let info = match doc.trailer.get(b"Info") {
        Ok(obj) => match doc.dereference(obj) {
            Ok((_, obj)) => obj.clone(),
            Err(_) => return (fallback_title.to_string(), None),
        },
        Err(_) => return (fallback_title.to_string(), None),
    };

    let dict = match info.as_dict() {
        Ok(d) => d,
        Err(_) => return (fallback_title.to_string(), None),
    };

    let title = dict
        .get(b"Title")
        .ok()
        .and_then(|obj| pdf_object_to_string(obj))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_title.to_string());

    let author = dict
        .get(b"Author")
        .ok()
        .and_then(|obj| pdf_object_to_string(obj))
        .filter(|s| !s.is_empty());

    (title, author)
}

fn pdf_object_to_string(obj: &lopdf::Object) -> Option<String> {
    match obj {
        lopdf::Object::String(bytes, _) => {
            // Try UTF-16BE first (BOM: 0xFE 0xFF), then fall back to Latin-1/UTF-8
            if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
                let utf16: Vec<u16> = bytes[2..]
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16(&utf16)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                Some(String::from_utf8_lossy(bytes).trim().to_string())
            }
        }
        _ => None,
    }
}
