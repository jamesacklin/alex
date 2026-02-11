## EPUB Reader Notes
- `src/components/readers/EpubReader.tsx` uses `react-reader` (epubjs) and customizes `ReactReaderStyle` / `EpubViewStyle`.
- `EpubReader` is dynamically imported with `ssr: false`, so it is client-only.
- EPUB content renders inside iframes; use `rendition.themes.default()` (often with `!important`) and/or `rendition.hooks.content.register` to override internal styles.
- Single-column, continuous scroll uses `rendition.flow("scrolled-doc")` and `rendition.spread("none")`.
- Theme colors come from CSS variables in `src/app/globals.css` (`--background`, `--foreground`, `--primary`, `--primary-foreground`) with dark mode via `.dark`.
- A `MutationObserver` tracks theme changes on `document.documentElement` and re-applies EPUB theme settings inside the iframe.

## Progress Tracking
- EPUB progress is stored as `epubLocation` (CFI) plus `percentComplete`.
- Saves are debounced (`queueProgressSave`), persisted to `localStorage`, and flushed on unmount.
- `localStorage` key `epub-progress:${bookId}` stores the last read location.
- Backend endpoint: `PUT /api/books/[id]/progress` in `src/app/api/books/[id]/progress/route.ts`.

## User Preferences
- EPUB should feel web-native: single-column scroll, no spreads, transparent backgrounds, and text color mapped to the app's primary text token.
