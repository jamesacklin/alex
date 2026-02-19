use image::ImageFormat;
use pdfium_render::prelude::*;
use std::path::{Path, PathBuf};

pub fn render_pdf_cover(file_path: &Path, book_id: &str, covers_dir: &Path) -> Option<PathBuf> {
    std::fs::create_dir_all(covers_dir).ok()?;

    let pdfium = Pdfium::new(Pdfium::bind_to_statically_linked_library().ok()?);
    let document = pdfium.load_pdf_from_file(file_path, None).ok()?;
    let page = document.pages().get(0).ok()?;

    let render = page
        .render_with_config(&PdfRenderConfig::new().scale_page_by_factor(150.0 / 72.0))
        .ok()?;

    let image = render.as_image().into_rgb8();
    let cover_path = covers_dir.join(format!("{book_id}.jpg"));

    image
        .save_with_format(&cover_path, ImageFormat::Jpeg)
        .ok()?;

    Some(cover_path)
}
