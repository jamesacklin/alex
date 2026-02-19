# PRD: PDF and EPUB Cover Generation in Rust (pdfium-render)

## Introduction

Add cover image generation to the `watcher-rs` Rust project. The current TypeScript watcher renders PDF page 1 at 150 DPI using `pdfjs-dist` + `@napi-rs/canvas`, encodes as JPEG, and writes to a covers directory. If rendering fails, it generates a synthetic gradient cover with the title and author overlaid. EPUB cover extraction pulls the cover image directly from the ZIP archive. This PRD covers porting both to Rust as a module within `watcher-rs`, using `pdfium-render` with statically linked PDFium for PDF rendering and `zip` for EPUB cover extraction.

## Goals

- Render PDF page 1 as a JPEG cover image at 150 DPI, matching the approximate dimensions of the current TypeScript output
- Extract EPUB cover images from the ZIP archive and write them to disk
- Provide a fallback synthetic gradient cover when PDF rendering or EPUB cover extraction fails
- Statically link PDFium so the binary has no runtime dependency on system-installed libraries
- Integrate as a module within the existing `watcher-rs` project (not a standalone binary)

## User Stories

### US-001: Render PDF page 1 as a cover image

**Description:** As a developer, I want the Rust watcher to render the first page of each PDF as a JPEG thumbnail so that the app can display book covers.

**Acceptance Criteria:**
- [ ] Opens the PDF file using `pdfium-render`
- [ ] Renders page 1 (index 0) at 150 DPI (scale factor 150/72 relative to the PDF's default 72 DPI)
- [ ] Encodes the rendered pixel buffer as JPEG
- [ ] Writes the JPEG file to `{covers_dir}/{book_id}.jpg`
- [ ] Creates the covers directory if it does not exist
- [ ] Returns the cover file path on success

### US-002: Extract EPUB cover image from ZIP

**Description:** As a developer, I want the Rust watcher to pull the embedded cover image from EPUB files so that the app can display book covers.

**Acceptance Criteria:**
- [ ] Opens the EPUB as a ZIP archive
- [ ] Parses `META-INF/container.xml` to locate the OPF file
- [ ] Parses the OPF to find the cover image reference (checks `<meta name="cover" content="..."/>` and `<item properties="cover-image"/>`)
- [ ] Reads the referenced image file from the ZIP
- [ ] Writes the image bytes to `{covers_dir}/{book_id}.jpg`
- [ ] If the source image is not JPEG (e.g., PNG), re-encodes as JPEG via the `image` crate
- [ ] Returns the cover file path on success, or `None` if no cover is found

### US-003: Generate fallback synthetic cover

**Description:** As a developer, I want a gradient-based fallback cover generated when PDF rendering or EPUB extraction fails, so that every book has some visual representation.

**Acceptance Criteria:**
- [ ] Generates a 400x600 pixel image
- [ ] Draws a vertical linear gradient background (dark indigo: `#1e1b4b` to `#312e81`)
- [ ] Draws a 5px accent bar across the top (`#6366f1`)
- [ ] Renders the book title in white, bold, ~34px equivalent, centered horizontally, word-wrapped to fit within 40px margins
- [ ] Renders the author (if present) in light indigo (`#a5b4fc`), ~20px equivalent, centered below the title
- [ ] Title and author block is vertically centered on the canvas
- [ ] Encodes as JPEG and writes to `{covers_dir}/{book_id}.jpg`
- [ ] Returns the cover file path on success, or `None` if rendering itself fails

### US-004: Integrate cover generation into watcher add/change handlers

**Description:** As a developer, I want the watcher's add and change handlers to call the cover generation module so that covers are created at ingest time.

**Acceptance Criteria:**
- [ ] `handleAdd`: after extracting metadata, calls cover generation; stores returned path as `cover_path` in the `books` INSERT
- [ ] `handleChange`: after re-extracting metadata, calls cover generation; if old `cover_path` existed but new generation returns `None`, deletes the old cover file
- [ ] Cover generation failures do not prevent the book from being added to the database (graceful degradation to `cover_path = NULL`)

### US-005: Statically link PDFium

**Description:** As a developer, I want PDFium statically linked into the binary so that end users do not need to install any system libraries.

**Acceptance Criteria:**
- [ ] `build.rs` or build configuration downloads the correct platform-specific PDFium static library from the `pdfium-binaries` project at build time
- [ ] The build works on macOS (arm64, x64), Linux (x64, arm64), and Windows (x64)
- [ ] No runtime `dlopen` or shared library lookup required
- [ ] `cargo build --release` produces a self-contained binary with no external PDFium dependency
- [ ] The PDFium binary download is cached (not re-downloaded on every build)

### US-006: Tests for cover generation

**Description:** As a developer, I want tests that verify cover images are generated correctly.

**Acceptance Criteria:**
- [ ] Test: rendering a valid PDF produces a JPEG file at the expected path
- [ ] Test: the output JPEG has non-zero dimensions (decode with `image` crate and check width/height > 0)
- [ ] Test: extracting a cover from a valid EPUB with an embedded cover image produces a JPEG file
- [ ] Test: an EPUB without a cover image returns `None` and does not write a file
- [ ] Test: fallback synthetic cover produces a 400x600 JPEG with non-zero file size
- [ ] Test: when PDF rendering fails (e.g., corrupted file), the fallback cover is generated instead
- [ ] Test: when both PDF rendering and fallback fail, the function returns `None` without panicking
- [ ] Tests use a temporary directory for cover output, cleaned up after each run

## Functional Requirements

- FR-1: PDF covers must be rendered from page 1 at 150 DPI using `pdfium-render` with a statically linked PDFium library
- FR-2: EPUB covers must be extracted by parsing `META-INF/container.xml` to find the OPF, locating the cover image reference in the OPF, and reading the image from the ZIP archive
- FR-3: Non-JPEG source images (PNG, GIF) from EPUBs must be re-encoded as JPEG before writing
- FR-4: The rendered/extracted image must be encoded as JPEG and written to `{covers_dir}/{book_id}.jpg`
- FR-5: The covers directory must be created if it does not exist
- FR-6: If PDF rendering fails, a synthetic gradient cover must be generated as a fallback
- FR-7: If EPUB cover extraction fails or no cover is found, a synthetic gradient cover must be generated as a fallback
- FR-8: If the fallback also fails, the function must return `None` (not panic), and the book is inserted with `cover_path = NULL`
- FR-9: The synthetic cover must be 400x600px with a dark indigo gradient (`#1e1b4b` to `#312e81`), a 5px indigo accent bar (`#6366f1`) at the top, white title text (~34px, bold, word-wrapped, centered), and light indigo author text (~20px, centered below title)
- FR-10: PDFium must be statically linked; no shared library or system install required at runtime
- FR-11: The module must expose a public API callable from the watcher's `add` and `change` handlers:
  - `generate_pdf_cover(file_path, book_id, title, author, covers_dir) -> Option<PathBuf>`
  - `generate_epub_cover(file_path, book_id, title, author, covers_dir) -> Option<PathBuf>`

## Non-Goals

- Runtime PDF rendering (browser-side rendering is handled by `react-pdf`/`pdfjs-dist` in the frontend)
- Rendering pages other than page 1
- Generating multiple thumbnail sizes or resolutions
- WebP or PNG output format
- Text extraction from PDFs (handled by `lopdf` in the watcher metadata extractor)
- Pixel-identical output compared to the TypeScript version (functionally similar is sufficient)
- Font embedding in the synthetic cover (system default sans-serif is acceptable; `tiny-skia` does not support text natively, so a raster font approach or the `ab_glyph` crate is needed)

## Technical Considerations

### Crate Dependencies

| Crate | Purpose |
|-------|---------|
| `pdfium-render` | PDF page rendering via statically linked PDFium |
| `image` | JPEG encoding, image decoding for EPUB covers |
| `tiny-skia` | 2D drawing for synthetic gradient covers |
| `ab_glyph` + `imageproc` | Text rendering on the synthetic cover (tiny-skia has no built-in text support) |
| `zip` | Reading EPUB archives (shared with EPUB metadata extractor) |
| `quick-xml` | Parsing OPF for cover image references (shared with EPUB metadata extractor) |

### PDFium Static Linking

The [`pdfium-binaries`](https://github.com/nicbarker/pdfium-binaries) project publishes pre-built static libraries for all major platforms. The recommended approach:

1. Add a `build.rs` that detects the target triple
2. Downloads the matching PDFium static archive (or uses a cached copy)
3. Extracts the archive and sets `cargo:rustc-link-search` and `cargo:rustc-link-lib=static=pdfium`
4. `pdfium-render` picks up the statically linked library at runtime via `Pdfium::bind_to_statically_linked_library()`

The `pdfium-render` crate has a `static` feature flag that enables this path. The static lib adds approximately 15MB to the final binary per platform.

### Synthetic Cover Text Rendering

`tiny-skia` handles the gradient and geometric drawing but does not support text. Two options:

- **`ab_glyph` + `imageproc`**: Rasterize glyphs onto an `image::RgbaImage`, then convert. This is the most common approach in the Rust ecosystem. Requires bundling a `.ttf` font file (e.g., a small open-source sans-serif like Inter or Noto Sans).
- **`cosmic-text`**: More capable text layout (handles wrapping, shaping) but heavier dependency.

Recommendation: `ab_glyph` + `imageproc` with a bundled font file included via `include_bytes!()`. The word-wrapping logic from the TypeScript version (character-width estimation) can be ported directly.

### Module Structure (within watcher-rs)

```
watcher-rs/src/
  covers/
    mod.rs            -- public API: generate_pdf_cover, generate_epub_cover
    pdf.rs            -- pdfium-render page 1 rendering
    epub.rs           -- ZIP cover image extraction
    fallback.rs       -- synthetic gradient cover generation
    font.ttf          -- bundled font for text rendering (or in assets/)
```

### Integration with Watcher Handlers

The cover module functions are called after metadata extraction:

```rust
// In add handler:
let cover_path = match file_type {
    "pdf" => covers::generate_pdf_cover(&file_path, &book_id, &title, author.as_deref(), &covers_dir),
    "epub" => covers::generate_epub_cover(&file_path, &book_id, &title, author.as_deref(), &covers_dir),
    _ => None,
};
// cover_path is Option<PathBuf>, stored as cover_path in the INSERT
```

### Current TypeScript Behavior Reference

The existing code in `watcher/extractors/pdf.ts`:
- Renders at scale `150 / 72` (150 DPI) -- the viewport dimensions depend on the PDF page size
- JPEG encoding at default quality (~75-80)
- Synthetic cover: 400x600px, gradient `#1e1b4b` to `#312e81`, accent bar `#6366f1`, title 34px bold white, author 20px `#a5b4fc`
- Word wrap based on character width estimation: `charWidth = fontSize * 0.6`, `charsPerLine = floor((canvasWidth - 80) / charWidth)`

## Success Metrics

- A test library of 50 PDFs produces cover images for all non-corrupted files
- A test library of 50 EPUBs produces cover images for all files that contain embedded covers
- Corrupted/coverless files get synthetic fallback covers
- `cargo build --release` produces a binary with no external PDFium dependency on macOS, Linux, and Windows
- Cover generation for a single PDF completes in under 2 seconds on average hardware

## Open Questions

- Which open-source font should be bundled for the synthetic cover? Inter and Noto Sans are both good candidates. Noto Sans has broader Unicode coverage but is larger.
- Should the JPEG quality level be configurable, or is a fixed default (e.g., 85) sufficient?
- Should the `build.rs` PDFium download require network access, or should CI pre-download and cache the libraries? Network-dependent builds can be fragile.
