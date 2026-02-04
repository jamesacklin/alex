# PRD: Phase 8 - Polish

## Introduction

Final polish pass focusing on user experience improvements: loading states with skeletons, graceful error handling with user feedback, keyboard shortcuts for power users, and responsive design refinements for mobile devices.

## Goals

- Provide smooth loading experiences with skeleton placeholders
- Handle errors gracefully with clear user feedback
- Add keyboard shortcuts for efficient navigation
- Ensure fully responsive design down to 375px viewport
- Display helpful empty states throughout the app

## User Stories

### US-8.1: Loading Skeletons
**Description:** As a user, I want visual feedback while content loads so the app feels responsive.

**Acceptance Criteria:**
- [ ] `src/components/library/BookCardSkeleton.tsx` - matches BookCard dimensions
- [ ] Library page shows skeleton grid while fetching books
- [ ] Collection page shows skeleton grid while loading
- [ ] Reader page shows skeleton while PDF/ePub loads
- [ ] User management table shows skeleton rows
- [ ] Smooth transition from skeleton to content (no layout shift)
- [ ] Verify in browser (throttle network to see skeletons)

### US-8.2: Error Handling
**Description:** As a user, I want clear feedback when errors occur so I know what went wrong.

**Acceptance Criteria:**
- [ ] API errors show toast notification with error message
- [ ] Failed book load shows error state with retry button
- [ ] Network errors show "You appear to be offline" indicator
- [ ] 404 pages for: missing book, missing collection, invalid routes
- [ ] Form validation errors shown inline (not just toast)
- [ ] API errors logged to console for debugging
- [ ] Verify in browser (test by disconnecting network, invalid URLs)

### US-8.3: Keyboard Shortcuts
**Description:** As a power user, I want keyboard shortcuts for common actions.

**Acceptance Criteria:**
- [ ] PDF Reader: Left/Right arrows (pages), +/- (zoom), Escape (close reader)
- [ ] ePub Reader: Left/Right arrows (pages), Escape (close reader)
- [ ] Library: / (focus search), Escape (clear search)
- [ ] Global: ? (show keyboard shortcuts help modal)
- [ ] Shortcuts help modal lists all available shortcuts
- [ ] Shortcuts don't trigger when typing in input fields
- [ ] Verify in browser

### US-8.4: Mobile Responsiveness
**Description:** As a mobile user, I want the app to work well on my phone.

**Acceptance Criteria:**
- [ ] Library grid: 1 column on mobile (<640px), 2 columns on tablet
- [ ] Sidebar: hidden by default on mobile, hamburger menu to toggle
- [ ] Reader: touch-friendly controls with adequate tap targets (44px min)
- [ ] Reader: swipe gestures for page navigation
- [ ] Forms: inputs sized appropriately, no horizontal scroll
- [ ] Dialogs: full-width on mobile, max-width on desktop
- [ ] Test at 375px viewport width (iPhone SE)
- [ ] Verify in browser using device emulation

### US-8.5: Empty States
**Description:** As a user, I want helpful messages when there's no content to display.

**Acceptance Criteria:**
- [ ] Empty library: illustration + "No books yet" + "Add PDF and ePub files to your library folder to get started"
- [ ] Empty search results: "No books match your search" + suggestion to try different terms
- [ ] Empty collections list: "Create your first collection" + create button
- [ ] Empty collection: "This collection is empty" + "Add books from your library"
- [ ] Empty Continue Reading: section not shown (rather than empty state)
- [ ] Empty user list (shouldn't happen): "No users found"
- [ ] Verify in browser

### US-8.6: Toast Notifications
**Description:** As a user, I want feedback for my actions so I know they succeeded.

**Acceptance Criteria:**
- [ ] Use Sonner (shadcn toast) for all notifications
- [ ] Success toasts: "Book added to collection", "Collection created", "User created", "Settings saved"
- [ ] Error toasts: "Failed to save progress", "Failed to create user", network errors
- [ ] Info toasts: "Library scan started" (if applicable)
- [ ] Toasts auto-dismiss after 4 seconds
- [ ] Toasts can be manually dismissed
- [ ] Position: bottom-right on desktop, bottom-center on mobile
- [ ] Verify in browser

### US-8.7: Consistent Error Boundaries
**Description:** As a user, if something crashes I want a graceful fallback instead of a blank screen.

**Acceptance Criteria:**
- [ ] Error boundary wraps main app content
- [ ] Error fallback shows: "Something went wrong" message
- [ ] Includes "Try again" button that reloads the page
- [ ] Errors logged to console with stack trace
- [ ] Reader has its own error boundary (crash doesn't break whole app)
- [ ] Verify by intentionally throwing error in component

### US-8.8: Performance Optimizations
**Description:** As a user, I want the app to feel fast and responsive.

**Acceptance Criteria:**
- [ ] Book covers lazy load (only load when in viewport)
- [ ] React Query/SWR caching for API responses
- [ ] Optimistic updates for quick actions (add to collection)
- [ ] Prefetch book data on hover (optional)
- [ ] No layout shifts during loading
- [ ] Verify with Lighthouse performance audit

## Functional Requirements

- FR-8.1: Skeleton components matching actual content dimensions
- FR-8.2: Error boundary components with retry functionality
- FR-8.3: Toast notifications for all user actions
- FR-8.4: Keyboard shortcuts with help modal (? key)
- FR-8.5: Responsive design for 375px-1920px viewports
- FR-8.6: Empty state components with helpful messages
- FR-8.7: Mobile hamburger menu for sidebar navigation
- FR-8.8: Touch-friendly controls in readers (44px tap targets)

## Non-Goals

- No offline mode / PWA / service worker
- No complex animation library (simple CSS transitions only)
- No i18n / localization (English only)
- No dark mode for whole app (only ePub reader themes)

## Design Considerations

- Skeletons: use shadcn Skeleton with pulse animation
- Error states: simple illustration + message + action button
- Toasts: minimal, non-intrusive, positioned to not block content
- Empty states: centered, with relevant illustration or icon
- Mobile: bottom navigation could be added later, sidebar menu for now

## Technical Considerations

- Use `react-hotkeys-hook` for keyboard shortcuts
- Use Sonner (already in shadcn) for toasts
- Use `next/image` with `loading="lazy"` for covers
- Use React Query's `suspense` mode with Suspense boundaries
- Test responsive design with Chrome DevTools device emulation
- Consider `prefers-reduced-motion` for animations

## Success Metrics

- No layout shifts (CLS < 0.1) during page loads
- Skeleton loading feels natural, not jarring
- All actions provide feedback within 100ms
- App is fully usable on iPhone SE (375px)
- Keyboard users can navigate without mouse

## Open Questions

- None - requirements are fully specified
