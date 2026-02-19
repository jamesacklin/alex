use image::ImageFormat;
use quick_xml::Reader;
use quick_xml::events::Event;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub fn extract_epub_cover(file_path: &Path, book_id: &str, covers_dir: &Path) -> Option<PathBuf> {
    std::fs::create_dir_all(covers_dir).ok()?;

    let file = std::fs::File::open(file_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;

    let opf_path = parse_container_xml(&mut archive)?;
    let cover_href = parse_opf_for_cover_href(&mut archive, &opf_path)?;

    let relative_cover_path = resolve_relative_path(&opf_path, &cover_href);
    let mut cover_file = archive.by_name(&relative_cover_path).ok()?;

    let mut bytes = Vec::new();
    cover_file.read_to_end(&mut bytes).ok()?;

    let decoded = image::load_from_memory(&bytes).ok()?;
    let cover_path = covers_dir.join(format!("{book_id}.jpg"));

    decoded
        .into_rgb8()
        .save_with_format(&cover_path, ImageFormat::Jpeg)
        .ok()?;

    Some(cover_path)
}

fn parse_container_xml(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    let mut container = archive.by_name("META-INF/container.xml").ok()?;
    let mut xml = String::new();
    container.read_to_string(&mut xml).ok()?;

    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                if e.local_name().as_ref() == b"rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.local_name().as_ref() == b"full-path" {
                            return Some(String::from_utf8_lossy(attr.value.as_ref()).to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }

    None
}

fn parse_opf_for_cover_href(
    archive: &mut zip::ZipArchive<std::fs::File>,
    opf_path: &str,
) -> Option<String> {
    let mut opf_file = archive.by_name(opf_path).ok()?;
    let mut xml = String::new();
    opf_file.read_to_string(&mut xml).ok()?;

    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();

    let mut cover_id: Option<String> = None;
    let mut cover_href_from_props: Option<String> = None;
    let mut item_hrefs: HashMap<String, String> = HashMap::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                let local_name = e.local_name();

                if local_name.as_ref() == b"meta" {
                    let mut name_attr: Option<String> = None;
                    let mut content_attr: Option<String> = None;

                    for attr in e.attributes().flatten() {
                        let key = attr.key.local_name();
                        let value = String::from_utf8_lossy(attr.value.as_ref()).to_string();

                        if key.as_ref() == b"name" {
                            name_attr = Some(value);
                        } else if key.as_ref() == b"content" {
                            content_attr = Some(value);
                        }
                    }

                    if name_attr.as_deref() == Some("cover") {
                        cover_id = content_attr;
                    }
                } else if local_name.as_ref() == b"item" {
                    let mut item_id: Option<String> = None;
                    let mut href: Option<String> = None;
                    let mut properties: Option<String> = None;

                    for attr in e.attributes().flatten() {
                        let key = attr.key.local_name();
                        let value = String::from_utf8_lossy(attr.value.as_ref()).to_string();

                        if key.as_ref() == b"id" {
                            item_id = Some(value);
                        } else if key.as_ref() == b"href" {
                            href = Some(value);
                        } else if key.as_ref() == b"properties" {
                            properties = Some(value);
                        }
                    }

                    if let (Some(id), Some(href_value)) = (item_id, href.clone()) {
                        item_hrefs.insert(id, href_value);
                    }

                    if let (Some(prop), Some(href_value)) = (properties.as_deref(), href) {
                        if prop.split_whitespace().any(|token| token == "cover-image") {
                            cover_href_from_props = Some(href_value);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }

    if let Some(href) = cover_href_from_props {
        return Some(href);
    }

    cover_id.and_then(|id| item_hrefs.get(&id).cloned())
}

fn resolve_relative_path(opf_path: &str, href: &str) -> String {
    let base = Path::new(opf_path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();

    base.join(href).to_string_lossy().replace('\\', "/")
}
