# PRD: Phase 6 - ePub Reader

## Introduction

Implement an ePub viewer with chapter navigation via table of contents, reading customization (font size, themes), and CFI-based progress tracking. The reader uses epub.js through the react-reader wrapper and saves progress on every chapter or page change.

## Goals

- Render ePub content with proper formatting and styling
- Navigate via table of contents sidebar
- Customize font size and color theme for comfortable reading
- Track progress using ePub CFI (Content Fragment Identifier) locations
- Save progress on every navigation event

## User Stories

### US-6.1: ePub Progress API
**Description:** As a reader, I need to save and retrieve ePub reading position using CFI locations.

**Acceptance Criteria:**
- [ ] `PUT /api/books/[id]/progress` accepts `{ epubLocation: string }` for ePubs
- [ ] Stores CFI string in `epubLocation` column
- [ ] Calculates approximate `percentComplete` from CFI (epub.js provides this)
- [ ] Returns saved location on `GET /api/books/[id]/progress`
- [ ] Updates `lastReadAt` timestamp
- [ ] Sets status to 'reading' on first save, 'completed' at 100%

### US-6.2: ePub Reader Page
**Description:** As a user, I want to read ePub books in a focused browser view.

**Acceptance Criteria:**
- [ ] Reader page at `/read/[bookId]` detects fileType
- [ ] Loads EpubReader component for ePub files
- [ ] Loads saved CFI location on mount and passes to reader
- [ ] Full-screen reading experience (minimal chrome)
- [ ] Back button to return to library
- [ ] Book title in header
- [ ] Verify in browser

### US-6.3: ePub Renderer Component
**Description:** As a user, I want ePubs rendered with proper formatting and typography.

**Acceptance Criteria:**
- [ ] `src/components/readers/EpubReader.tsx`
- [ ] Uses `react-reader` library (wraps epub.js)
- [ ] Renders ePub content in embedded iframe
- [ ] Handles location changes via `locationChanged` callback
- [ ] Shows loading state while ePub parses
- [ ] Shows error message if ePub fails to load
- [ ] Verify in browser

### US-6.4: Chapter Navigation
**Description:** As a user, I want to navigate via table of contents.

**Acceptance Criteria:**
- [ ] TOC toggle button in toolbar
- [ ] TOC displays as sidebar/drawer overlay
- [ ] Shows all chapter titles from ePub navigation
- [ ] Click chapter to navigate directly
- [ ] Current chapter highlighted in TOC list
- [ ] Previous chapter button (navigates to start of previous chapter)
- [ ] Next chapter button (navigates to start of next chapter)
- [ ] Close TOC when chapter selected
- [ ] Verify in browser

### US-6.5: Reading Customization
**Description:** As a user, I want to customize the reading experience for comfort.

**Acceptance Criteria:**
- [ ] Settings button in toolbar opens settings panel
- [ ] Font size options: Small (14px), Medium (16px), Large (18px), XL (20px)
- [ ] Theme options: Light (white bg, black text), Dark (dark bg, light text), Sepia (cream bg, brown text)
- [ ] Settings apply immediately to reader
- [ ] Settings persist in localStorage (not database)
- [ ] Default: Medium font, Light theme
- [ ] Verify in browser

### US-6.6: Progress Tracking
**Description:** As a user, I want my reading position saved automatically.

**Acceptance Criteria:**
- [ ] Saves CFI location to API on every location change
- [ ] Location changes on: page turn, chapter navigation, swipe
- [ ] Resumes at exact saved location when reopening book
- [ ] Progress percentage displayed in UI (from epub.js calculation)
- [ ] Marks book as 'completed' when reaching end
- [ ] Verify in browser

### US-6.7: ePub Toolbar
**Description:** As a user, I need a toolbar with ePub-specific controls.

**Acceptance Criteria:**
- [ ] `src/components/readers/EpubToolbar.tsx`
- [ ] Left section: Back button, book title
- [ ] Center section: Previous/Next chapter buttons, progress indicator
- [ ] Right section: TOC toggle, Settings toggle
- [ ] Toolbar fixed at top
- [ ] Progress shows: "Chapter X of Y" or percentage
- [ ] Verify in browser

### US-6.8: Page Turn Navigation
**Description:** As a user, I want to turn pages within a chapter.

**Acceptance Criteria:**
- [ ] Click/tap left side of reader area: previous page
- [ ] Click/tap right side of reader area: next page
- [ ] Swipe left: next page (touch devices)
- [ ] Swipe right: previous page (touch devices)
- [ ] Keyboard: Left Arrow (previous), Right Arrow (next)
- [ ] Visual feedback on page turn (subtle animation from react-reader)
- [ ] Verify in browser

## Functional Requirements

- FR-6.1: ePub rendering using react-reader (epub.js wrapper)
- FR-6.2: CFI-based progress tracking with API persistence
- FR-6.3: Table of contents navigation with chapter highlighting
- FR-6.4: Font size options: 14px, 16px, 18px, 20px
- FR-6.5: Theme options: Light, Dark, Sepia
- FR-6.6: Settings persisted in localStorage
- FR-6.7: Progress saved on every navigation event (page/chapter change)
- FR-6.8: Touch and keyboard navigation support

## Non-Goals

- No annotations, highlights, or notes
- No bookmarks beyond the single saved position
- No dictionary or word lookup
- No text-to-speech (TTS)
- No custom fonts (use system/epub default)

## Design Considerations

- Reader area should maximize content space
- TOC as slide-out drawer from left
- Settings as dropdown panel from toolbar button
- Theme colors:
  - Light: #ffffff background, #1a1a1a text
  - Dark: #1a1a1a background, #e5e5e5 text
  - Sepia: #f4ecd8 background, #5b4636 text
- Toolbar should be minimal to maximize reading space

## Technical Considerations

- react-reader handles most epub.js complexity
- Wrap ReactReader in `useMemo` to prevent iframe recreation
- CFI (Content Fragment Identifier) is epub.js format: `epubcfi(/6/4!/4/2/1:0)`
- epub.js provides `book.locations.percentageFromCfi()` for progress
- Font size applied via epub.js rendition themes API
- Theme colors applied via rendition themes as well
- Test with various ePub files (different publishers, DRM-free)

## Success Metrics

- ePub loads and displays within 3 seconds
- Chapter navigation works for all ePubs tested
- Font and theme changes apply instantly
- Progress accurately restored on reopen
- Swipe navigation feels natural on touch devices

## Open Questions

- None - requirements are fully specified
