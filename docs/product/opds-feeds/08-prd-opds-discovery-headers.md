# PRD: OPDS Auto-Discovery Headers

## Introduction/Overview
Add OPDS auto-discovery link tags to HTML pages so OPDS clients and browsers can locate the catalog feed.

## Goals
- Publish the authenticated catalog link on general pages.
- Publish shared collection feed links on shared collection pages.
- Keep changes additive and invisible to end users.

## User Stories

### US-001: Add global OPDS discovery link
**Description:** As a developer, I want the main layout to include an OPDS alternate link to the authenticated catalog.

**Acceptance Criteria:**
- [ ] `src/app/layout.tsx` includes a `<link rel="alternate">` tag for `/opds/v1.2/catalog`.
- [ ] The `type` attribute is `application/atom+xml;profile=opds-catalog`.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-002: Add shared collection discovery link
**Description:** As a developer, I want shared collection pages to include an OPDS alternate link for their feed.

**Acceptance Criteria:**
- [ ] Pages rendering `/shared/{token}` include a `<link rel="alternate">` tag for `/opds/shared/{token}`.
- [ ] The tag uses an appropriate `title` such as "Shared Collection".
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

## Functional Requirements
1. Add an OPDS discovery `<link>` tag in the main layout for the authenticated catalog.
2. Add a discovery `<link>` tag for shared collection pages only.
3. Use the OPDS 1.2 media type and stable titles.

## Non-Goals
- OPDS 2.0 discovery links.
- Visible UI changes or user-facing copy changes.

## Design Considerations
- None.

## Technical Considerations
- Prefer absolute-path `href` values so the same markup works across environments.

## Success Metrics
- The discovery `<link>` tags are present in page HTML and match expected URLs.

## Open Questions
- Should discovery links use absolute URLs with origin, or keep relative paths?
