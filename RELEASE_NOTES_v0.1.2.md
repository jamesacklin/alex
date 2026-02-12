# Release v0.1.2: EPUB Reader Improvements

This patch release focuses on significant enhancements to the EPUB reading experience, including layout improvements, better typography, and smoother navigation.

## Layout & Typography
- **80ch column layout**: Added max-width constraint with centered content for improved readability
- **IBM Plex Serif font**: Implemented with normalized font scaling to prevent size compounding when adjusting reader settings
- **Font size fixes**: Resolved font-size inheritance issues that were causing microscopic text in some EPUBs
- **Responsive media**: Improved sizing for images and other media elements within EPUB content

## Navigation & Scrolling
- **Fixed upward scrolling jumps**: Eliminated jarring position changes when scrolling backwards
- **Stabilized chapter boundaries**: Smooth transitions when moving between chapters
- **Scroll position restoration**: Improved backward navigation with accurate position memory
- **Edge scrolling fixes**: Better handling of scroll behavior at document boundaries

## Progress & Persistence
- **Debounced progress saving**: More efficient progress tracking with reduced writes
- **CFI validation**: Added validation on load to ensure saved positions are valid
- **Enhanced auto-advance**: Improved continuous scroll with automatic chapter advancement

## Technical Improvements
- **Theme override handling**: Better application of theme colors inside EPUB iframes
- **Safe epubjs hooks**: Added guards for content hook access to prevent errors
- **Content doc styling**: Improved font-size application in EPUB content documents

These changes align with the web-native, single-column reading experience while maintaining compatibility with various EPUB formats and internal styling approaches.

---

https://claude.ai/code/session_8ABO4
