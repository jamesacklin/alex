use ab_glyph::{FontArc, PxScale};
use image::{ImageFormat, Rgb, RgbImage};
use imageproc::drawing::{draw_text_mut, text_size};
use std::path::{Path, PathBuf};

const WIDTH: u32 = 400;
const HEIGHT: u32 = 600;
const TITLE_FONT_SIZE: f32 = 34.0;
const AUTHOR_FONT_SIZE: f32 = 20.0;

const GRADIENT_TOP: [u8; 3] = [0x1e, 0x1b, 0x4b];
const GRADIENT_BOTTOM: [u8; 3] = [0x31, 0x2e, 0x81];
const ACCENT: [u8; 3] = [0x63, 0x66, 0xf1];
const TITLE_COLOR: [u8; 3] = [0xff, 0xff, 0xff];
const AUTHOR_COLOR: [u8; 3] = [0xa5, 0xb4, 0xfc];

const FONT_BYTES: &[u8] = include_bytes!("fonts/NotoSans-VF.ttf");

pub fn generate_synthetic_cover(
    book_id: &str,
    title: &str,
    author: Option<&str>,
    covers_dir: &Path,
) -> Option<PathBuf> {
    std::fs::create_dir_all(covers_dir).ok()?;

    let font = FontArc::try_from_slice(FONT_BYTES).ok()?;
    let mut image = RgbImage::new(WIDTH, HEIGHT);

    draw_background_gradient(&mut image);
    draw_accent_bar(&mut image);
    draw_title_and_author(&mut image, &font, title, author);

    let output = covers_dir.join(format!("{book_id}.jpg"));
    image.save_with_format(&output, ImageFormat::Jpeg).ok()?;
    Some(output)
}

fn draw_background_gradient(image: &mut RgbImage) {
    for y in 0..HEIGHT {
        let t = y as f32 / (HEIGHT.saturating_sub(1)) as f32;
        let color = lerp_color(GRADIENT_TOP, GRADIENT_BOTTOM, t);
        for x in 0..WIDTH {
            image.put_pixel(x, y, Rgb(color));
        }
    }
}

fn draw_accent_bar(image: &mut RgbImage) {
    for y in 0..5 {
        for x in 0..WIDTH {
            image.put_pixel(x, y, Rgb(ACCENT));
        }
    }
}

fn draw_title_and_author(image: &mut RgbImage, font: &FontArc, title: &str, author: Option<&str>) {
    let title_scale = PxScale::from(TITLE_FONT_SIZE);
    let author_scale = PxScale::from(AUTHOR_FONT_SIZE);

    let title_lines = wrap_text(title, (WIDTH - 80) as f32, TITLE_FONT_SIZE);
    let line_height = (TITLE_FONT_SIZE * 1.3).round() as i32;

    let author_gap = if author.is_some() { 36 } else { 0 };
    let block_height = (title_lines.len() as i32 * line_height) + author_gap;

    let mut y = ((HEIGHT as i32 - block_height) / 2) + TITLE_FONT_SIZE.round() as i32;

    for line in title_lines {
        draw_centered_text(image, font, &line, title_scale, TITLE_COLOR, y, true);
        y += line_height;
    }

    if let Some(author_text) = author {
        draw_centered_text(
            image,
            font,
            author_text,
            author_scale,
            AUTHOR_COLOR,
            y + 16,
            false,
        );
    }
}

fn draw_centered_text(
    image: &mut RgbImage,
    font: &FontArc,
    text: &str,
    scale: PxScale,
    color: [u8; 3],
    y: i32,
    faux_bold: bool,
) {
    let (text_w, _) = text_size(scale, font, text);
    let x = ((WIDTH as i32 - text_w as i32) / 2).max(20);

    draw_text_mut(image, Rgb(color), x, y, scale, font, text);

    if faux_bold {
        draw_text_mut(image, Rgb(color), x + 1, y, scale, font, text);
    }
}

fn wrap_text(text: &str, max_width: f32, font_size: f32) -> Vec<String> {
    let char_width = font_size * 0.6;
    let chars_per_line = (max_width / char_width).floor().max(1.0) as usize;

    let mut lines = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let candidate = if current.is_empty() {
            word.to_string()
        } else {
            format!("{} {}", current, word)
        };

        if candidate.chars().count() <= chars_per_line {
            current = candidate;
        } else {
            if !current.is_empty() {
                lines.push(current);
            }
            current = word.to_string();
        }
    }

    if !current.is_empty() {
        lines.push(current);
    }

    if lines.is_empty() {
        vec!["Untitled".to_string()]
    } else {
        lines
    }
}

fn lerp_color(start: [u8; 3], end: [u8; 3], t: f32) -> [u8; 3] {
    [
        lerp_channel(start[0], end[0], t),
        lerp_channel(start[1], end[1], t),
        lerp_channel(start[2], end[2], t),
    ]
}

fn lerp_channel(start: u8, end: u8, t: f32) -> u8 {
    let s = start as f32;
    let e = end as f32;
    (s + (e - s) * t).round().clamp(0.0, 255.0) as u8
}
