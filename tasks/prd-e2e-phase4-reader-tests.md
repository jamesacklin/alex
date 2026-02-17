# PRD: E2E Testing Phase 4 - PDF and EPUB Reader Tests

## Introduction

Implement end-to-end tests for Alex's PDF and EPUB readers, validating core reading functionality including page navigation, zoom, theme switching, progress tracking, and resume-from-last-location. This phase ensures both reader types work correctly on web and Electron platforms.

## Goals

- Create page object models for PDF and EPUB readers
- Write comprehensive tests for PDF reader (page navigation, zoom, progress)
- Write comprehensive tests for EPUB reader (scroll, navigation, progress, themes)
- Verify reading progress persists to API and localStorage
- Verify resume-from-last-location works correctly
- Ensure tests pass on both web and Electron platforms

## User Stories

### US-001: Create PDF reader page object
**Description:** As a developer, I need a page object for the PDF reader so test selectors and actions are centralized.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/pdf-reader.page.ts`
- [ ] Export `PdfReaderPage` class with constructor accepting `Page` object
- [ ] Implement `backButton` selector
- [ ] Implement `pageNumberDisplay` selector (shows "Page X of Y")
- [ ] Implement `previousPageButton` selector
- [ ] Implement `nextPageButton` selector
- [ ] Implement `pageInput` selector (jump to page)
- [ ] Implement `zoomInButton` selector
- [ ] Implement `zoomOutButton` selector
- [ ] Implement `progressBar` selector
- [ ] Implement `getCurrentPage()` method (parses displayed page number)
- [ ] Implement `getTotalPages()` method (parses total pages)
- [ ] Implement `clickNextPage()` method
- [ ] Implement `clickPreviousPage()` method
- [ ] Implement `jumpToPage(pageNum)` method
- [ ] Implement `getProgressPercent()` method (reads progress bar)
- [ ] Implement `zoomIn()` and `zoomOut()` methods
- [ ] Typecheck passes

### US-002: Create EPUB reader page object
**Description:** As a developer, I need a page object for the EPUB reader so test selectors and actions are centralized.

**Acceptance Criteria:**
- [ ] Create `e2e/page-objects/epub-reader.page.ts`
- [ ] Export `EpubReaderPage` class with constructor accepting `Page` object
- [ ] Implement `backButton` selector
- [ ] Implement `tocButton` selector (Table of Contents)
- [ ] Implement `settingsButton` selector (font size, theme)
- [ ] Implement `previousChapterButton` selector
- [ ] Implement `nextChapterButton` selector
- [ ] Implement `progressBar` selector
- [ ] Implement `readerContent` selector (main EPUB content area)
- [ ] Implement `tocSidebar` selector
- [ ] Implement `scrollDown()` method (scrolls EPUB content)
- [ ] Implement `clickNextChapter()` method
- [ ] Implement `clickPreviousChapter()` method
- [ ] Implement `openToc()` method
- [ ] Implement `clickTocItem(label)` method
- [ ] Implement `openSettings()` method
- [ ] Implement `setFontSize(size)` method (small/medium/large/xl)
- [ ] Implement `getProgressPercent()` method
- [ ] Typecheck passes

### US-003: Test PDF opens and renders first page
**Description:** As a user, I want to open a PDF book and see the first page rendered.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/pdf-reader.spec.ts`
- [ ] Import `test` from `auth.fixture.ts`
- [ ] Test navigates to a known PDF book (from seed data)
- [ ] Test verifies PDF viewer loads without errors
- [ ] Test verifies page 1 is displayed (page number shows "1")
- [ ] Test verifies total pages > 0
- [ ] Test verifies PDF canvas/content is visible
- [ ] Test passes on both `pnpm e2e:web` and `pnpm e2e:electron`
- [ ] Typecheck passes

### US-004: Test PDF page navigation (next/previous)
**Description:** As a user, I want to navigate between PDF pages using next/previous buttons.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/pdf-reader.spec.ts`
- [ ] Test opens a multi-page PDF (seed data must have PDF with 2+ pages)
- [ ] Test clicks "Next Page" button
- [ ] Test verifies page number increments to 2
- [ ] Test clicks "Previous Page" button
- [ ] Test verifies page number returns to 1
- [ ] Test verifies "Previous" button is disabled on page 1
- [ ] Test navigates to last page and verifies "Next" button is disabled
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-005: Test PDF jump to specific page
**Description:** As a user, I want to jump to a specific page number in a PDF.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/pdf-reader.spec.ts`
- [ ] Test opens a multi-page PDF
- [ ] Test enters a specific page number (e.g., "5") in page input field
- [ ] Test presses Enter or clicks jump button
- [ ] Test verifies navigation to page 5
- [ ] Test verifies page number display updates to 5
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-006: Test PDF zoom in/out
**Description:** As a user, I want to zoom in and out of PDF pages for better readability.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/pdf-reader.spec.ts`
- [ ] Test opens a PDF
- [ ] Test clicks "Zoom In" button
- [ ] Test verifies PDF content size increases (visual or percentage check)
- [ ] Test clicks "Zoom Out" button
- [ ] Test verifies PDF content size decreases
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-007: Test PDF progress tracking and persistence
**Description:** As a user, I want my reading progress to save so I can resume where I left off.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/pdf-reader.spec.ts`
- [ ] Test opens a PDF and navigates to page 3
- [ ] Test waits for progress save (debounced, ~2 seconds)
- [ ] Test verifies progress bar reflects current position (~60% if 5 pages total)
- [ ] Test navigates away (back to library)
- [ ] Test reopens the same PDF
- [ ] Test verifies PDF resumes at page 3 (not page 1)
- [ ] Test verifies progress bar still shows ~60%
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-008: Test EPUB opens and renders content
**Description:** As a user, I want to open an EPUB book and see the content rendered.

**Acceptance Criteria:**
- [ ] Create `e2e/specs/epub-reader.spec.ts`
- [ ] Import `test` from `auth.fixture.ts`
- [ ] Test navigates to a known EPUB book (from seed data)
- [ ] Test verifies EPUB viewer loads without errors
- [ ] Test verifies EPUB content is visible (text or iframe content)
- [ ] Test verifies title is displayed in header
- [ ] Test passes on both `pnpm e2e:web` and `pnpm e2e:electron`
- [ ] Typecheck passes

### US-009: Test EPUB scroll advances through content
**Description:** As a user, I want to scroll through EPUB content to read continuously.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/epub-reader.spec.ts`
- [ ] Test opens an EPUB
- [ ] Test scrolls down through content
- [ ] Test verifies scroll position changes (via scroll offset or CFI change)
- [ ] Test verifies progress bar advances as user scrolls
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-010: Test EPUB chapter navigation
**Description:** As a user, I want to navigate between EPUB chapters using next/previous buttons.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/epub-reader.spec.ts`
- [ ] Test opens a multi-chapter EPUB (seed data must have EPUB with 2+ chapters)
- [ ] Test clicks "Next Chapter" button
- [ ] Test verifies content changes (new chapter visible)
- [ ] Test clicks "Previous Chapter" button
- [ ] Test verifies return to first chapter
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-011: Test EPUB Table of Contents (ToC)
**Description:** As a user, I want to open the Table of Contents and jump to a specific chapter.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/epub-reader.spec.ts`
- [ ] Test opens an EPUB with ToC
- [ ] Test clicks ToC button
- [ ] Test verifies ToC sidebar opens with chapter list
- [ ] Test clicks a ToC item (e.g., "Chapter 2")
- [ ] Test verifies navigation to that chapter (content changes)
- [ ] Test verifies ToC sidebar closes
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-012: Test EPUB theme changes (dark/light)
**Description:** As a user, I want to change the EPUB theme for better readability.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/epub-reader.spec.ts`
- [ ] Test opens an EPUB
- [ ] Test opens settings panel
- [ ] Test toggles dark mode (if app has dark mode toggle)
- [ ] Test verifies EPUB content theme changes (background/text color)
- [ ] Test toggles back to light mode
- [ ] Test verifies EPUB content returns to light theme
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-013: Test EPUB font size changes
**Description:** As a user, I want to adjust font size for better readability.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/epub-reader.spec.ts`
- [ ] Test opens an EPUB
- [ ] Test opens settings panel
- [ ] Test selects "Large" font size
- [ ] Test verifies EPUB content font increases (visual check or computed style)
- [ ] Test selects "Small" font size
- [ ] Test verifies EPUB content font decreases
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

### US-014: Test EPUB progress tracking and persistence
**Description:** As a user, I want my EPUB reading progress (CFI + percentage) to save so I can resume later.

**Acceptance Criteria:**
- [ ] Add test to `e2e/specs/epub-reader.spec.ts`
- [ ] Test opens an EPUB and scrolls to ~50% through the book
- [ ] Test waits for progress save (debounced, ~2 seconds)
- [ ] Test verifies progress bar shows ~50%
- [ ] Test navigates away (back to library)
- [ ] Test reopens the same EPUB
- [ ] Test verifies EPUB resumes at saved location (scroll position ~50%)
- [ ] Test verifies progress bar still shows ~50%
- [ ] Test passes on both web and Electron
- [ ] Typecheck passes

## Functional Requirements

- FR-1: PDF reader page object must centralize all PDF controls (navigation, zoom, progress)
- FR-2: EPUB reader page object must centralize all EPUB controls (navigation, ToC, settings, progress)
- FR-3: Tests must verify both readers load and render content correctly
- FR-4: Tests must verify page/chapter navigation works in both directions
- FR-5: Tests must verify PDF zoom controls change content size
- FR-6: Tests must verify EPUB font size and theme controls work
- FR-7: Tests must verify reading progress saves to API (`PUT /api/books/[id]/progress`)
- FR-8: Tests must verify progress persists after navigating away and returning
- FR-9: Tests must verify resume-from-last-location works correctly (PDF page, EPUB CFI)
- FR-10: All tests must pass on both web and Electron platforms

## Non-Goals

- No testing of PDF annotations or highlighting (features don't exist)
- No testing of EPUB search or bookmarking (not implemented yet)
- No testing of PDF text selection or copy (browser native, hard to test)
- No testing of EPUB image rendering (assume epubjs handles this)
- No performance testing of large PDFs (1000+ pages) or EPUBs
- No visual regression testing of reader UI
- No testing of keyboard shortcuts (arrow keys, spacebar) — can add later

## Technical Considerations

- PDF reader uses `react-pdf` library with `pdf.js` worker
- EPUB reader uses `react-reader` (epubjs) with iframe-based rendering
- PDF progress is stored as `currentPage` and `totalPages`
- EPUB progress is stored as `epubLocation` (CFI string) and `percentComplete`
- Progress saves are debounced (~2 seconds) before API call
- Progress API endpoint: `PUT /api/books/[id]/progress`
- EPUB content renders inside iframes; selectors may need `frameLocator()`
- EPUB theme changes use `rendition.themes.default()` with CSS variables
- Resuming EPUB location uses `display(savedCfi)` on load
- Resuming PDF page uses `initialPage` prop

## Success Metrics

- All reader tests pass on both `pnpm e2e:web` and `pnpm e2e:electron`
- Tests run in under 90 seconds total
- No flaky tests (100% pass rate)
- Progress tracking is verified via both UI and API responses
- Tests are readable and maintainable (each test under 30 lines)

## Open Questions

- Should we test PDF print functionality?
  - Recommendation: No, browser print dialog is outside test scope
- Should we test EPUB text selection or copy?
  - Recommendation: No, too complex and browser-dependent
- How long should we wait for progress saves before verifying?
  - Recommendation: 3 seconds to account for debounce + API latency
- Should we mock the progress API for faster tests?
  - Recommendation: No, use real API to ensure integration works correctly
