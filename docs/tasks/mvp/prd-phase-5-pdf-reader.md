# PRD: Phase 5 - PDF Reader

## Introduction

Implement a full-featured PDF viewer with page navigation, zoom controls, text search, and progress tracking. The reader provides a focused, full-screen reading experience with progress automatically saved when the user changes pages.

## Goals

- Render PDF files with good visual quality and performance
- Navigate pages easily with buttons, keyboard, and direct page input
- Zoom in/out with preset and custom zoom levels
- Search for text within the document
- Track and save reading progress on every page change

## User Stories

### US-5.1: Book File Streaming API
**Description:** As a reader component, I need to stream the book file for rendering.

**Acceptance Criteria:**
- [ ] `GET /api/books/[id]/file` endpoint
- [ ] Streams file from disk with correct `Content-Type` (application/pdf)
- [ ] Supports HTTP range requests for large files (partial content)
- [ ] Requires authentication (returns 401 if not logged in)
- [ ] Returns 404 if book not found
- [ ] Sets `Content-Disposition: inline` header

### US-5.2: Reading Progress API
**Description:** As a reader, I need to save and retrieve my reading progress.

**Acceptance Criteria:**
- [ ] `GET /api/books/[id]/progress` - returns current progress or null
- [ ] `PUT /api/books/[id]/progress` - updates progress
- [ ] Request body: `{ currentPage: number, totalPages: number }`
- [ ] Automatically calculates `percentComplete` from page numbers
- [ ] Updates `lastReadAt` timestamp on every save
- [ ] Sets status to 'reading' on first progress update
- [ ] Sets status to 'completed' when currentPage equals totalPages

### US-5.3: PDF Reader Page
**Description:** As a user, I want to read PDF books in a focused, full-screen browser view.

**Acceptance Criteria:**
- [ ] `src/app/(dashboard)/read/[bookId]/page.tsx`
- [ ] Loads book metadata and saved progress on mount
- [ ] Verifies book is PDF type (redirects to library if ePub)
- [ ] Renders PDF using PdfReader component
- [ ] Full-screen layout (no sidebar, minimal chrome)
- [ ] Back button/link to return to library
- [ ] Book title displayed in header
- [ ] Verify in browser

### US-5.4: PDF Renderer Component
**Description:** As a user, I want PDFs rendered clearly with good performance.

**Acceptance Criteria:**
- [ ] `src/components/readers/PdfReader.tsx`
- [ ] Uses `react-pdf` library (Document and Page components)
- [ ] Configures PDF.js worker (from CDN or bundled)
- [ ] Renders single page at a time (not continuous scroll)
- [ ] Scales page to fit container width by default
- [ ] Shows loading spinner while page renders
- [ ] Shows error message if PDF fails to load
- [ ] Verify in browser

### US-5.5: Page Navigation
**Description:** As a user, I want to navigate between pages easily.

**Acceptance Criteria:**
- [ ] Previous page button (disabled on page 1)
- [ ] Next page button (disabled on last page)
- [ ] Page number input field for direct jump (validates 1 to totalPages)
- [ ] Display: "Page X of Y" format
- [ ] Keyboard shortcuts: Left Arrow (prev), Right Arrow (next)
- [ ] Keyboard shortcuts: Home (first page), End (last page)
- [ ] Progress saved to API on every page change
- [ ] Verify in browser

### US-5.6: Zoom Controls
**Description:** As a user, I want to zoom in and out of the PDF for comfortable reading.

**Acceptance Criteria:**
- [ ] Zoom out button (-) decreases zoom by 25%
- [ ] Zoom in button (+) increases zoom by 25%
- [ ] "Fit Width" button scales to container width
- [ ] "Fit Page" button scales to show full page
- [ ] Zoom percentage display (e.g., "100%")
- [ ] Zoom range: 50% to 200%
- [ ] Keyboard shortcuts: + (zoom in), - (zoom out)
- [ ] Zoom level persists during session (localStorage)
- [ ] Verify in browser

### US-5.7: Text Search
**Description:** As a user, I want to search for text within the PDF.

**Acceptance Criteria:**
- [ ] Search input field in toolbar (collapsible/expandable)
- [ ] Highlights all matches on current page
- [ ] "Next match" and "Previous match" buttons
- [ ] Match count display: "X of Y matches"
- [ ] Keyboard shortcut: Ctrl/Cmd+F to focus search input
- [ ] Enter key goes to next match
- [ ] Escape key closes search and clears highlights
- [ ] Verify in browser

### US-5.8: Reader Toolbar
**Description:** As a user, I need a toolbar with all reader controls organized logically.

**Acceptance Criteria:**
- [ ] `src/components/readers/PdfToolbar.tsx`
- [ ] Left section: Back button, book title
- [ ] Center section: Page navigation (prev, page input, next)
- [ ] Right section: Search toggle, zoom controls
- [ ] Toolbar stays fixed at top during scroll
- [ ] Responsive: controls stack or hide on small screens
- [ ] Verify in browser

## Functional Requirements

- FR-5.1: Stream PDF files with range request support for large files
- FR-5.2: Progress API saves page number and calculates percentage
- FR-5.3: Progress saved on every page change (not debounced since navigations are discrete)
- FR-5.4: PDF rendering using react-pdf with PDF.js worker
- FR-5.5: Page navigation with keyboard support (arrows, Home, End)
- FR-5.6: Zoom controls with presets (50%-200%, fit width, fit page)
- FR-5.7: Text search with match highlighting and navigation
- FR-5.8: Fixed toolbar with organized controls

## Non-Goals

- No annotations, highlighting, or drawing
- No bookmarks or table of contents
- No printing functionality
- No continuous scroll mode (single page only)
- No two-page spread view

## Design Considerations

- Dark background behind PDF for reduced eye strain
- Toolbar: semi-transparent or solid based on scroll position
- Page transitions: instant (no animations)
- Search highlights: yellow background on matched text
- Controls sized for touch on tablet devices

## Technical Considerations

- Configure PDF.js worker: `pdfjs.GlobalWorkerOptions.workerSrc`
- Use `react-pdf` v7+ for React 18 compatibility
- Page rendering uses canvas (default) for best quality
- For search, use PDF.js `getTextContent()` API
- Consider lazy loading react-pdf to reduce initial bundle size
- Test with large PDFs (100+ pages) for performance

## Success Metrics

- PDF loads and displays first page within 2 seconds
- Page navigation feels instant (<100ms)
- Zoom is smooth without janky re-renders
- Search finds text accurately
- Progress is reliably saved and restored

## Open Questions

- None - requirements are fully specified
