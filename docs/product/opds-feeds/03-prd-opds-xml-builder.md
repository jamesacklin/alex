# PRD: OPDS XML Builder Utilities

## Introduction/Overview
Create helper utilities to generate well-formed OPDS 1.2 Atom XML for navigation feeds, acquisition feeds, book entries, and OpenSearch descriptions. This centralizes XML formatting and escaping.

## Goals
- Produce consistent, valid OPDS 1.2 XML across routes.
- Ensure all text content is safely XML-escaped.
- Make feed construction easy and reusable.

## User Stories

### US-001: Build navigation feeds
**Description:** As a developer, I want `buildNavigationFeed` to generate a navigation feed with entries linking to sub-feeds.

**Acceptance Criteria:**
- [ ] The function returns a full `<feed>` document string.
- [ ] Required Atom and OPDS namespaces are present on the root element.
- [ ] Entries include `title`, `id`, and `updated` fields.
- [ ] Typecheck/lint passes.

### US-002: Build acquisition feeds with pagination and facets
**Description:** As a developer, I want `buildAcquisitionFeed` to generate an acquisition feed with book entries and pagination links.

**Acceptance Criteria:**
- [ ] The function accepts entries, `self`, `start`, and optional `next` or `previous` links.
- [ ] The output includes acquisition entries and optional facet links.
- [ ] Typecheck/lint passes.

### US-003: Build a book entry
**Description:** As a developer, I want `buildEntry` to generate a single OPDS entry with acquisition and cover links.

**Acceptance Criteria:**
- [ ] The entry includes title, id, updated, author, and optional description and language.
- [ ] Acquisition link uses `http://opds-spec.org/acquisition/open-access`.
- [ ] Cover and thumbnail links are included when available.
- [ ] Typecheck/lint passes.

### US-004: Build OpenSearch description
**Description:** As a developer, I want `buildOpenSearchDescription` to generate the OpenSearch XML document for OPDS search discovery.

**Acceptance Criteria:**
- [ ] The output uses `application/opensearchdescription+xml` compatible structure.
- [ ] The search URL template includes `{searchTerms}`.
- [ ] Typecheck/lint passes.

## Functional Requirements
1. Add `src/lib/opds/xml.ts` with `buildNavigationFeed`, `buildAcquisitionFeed`, `buildEntry`, and `buildOpenSearchDescription`.
2. Root `<feed>` includes the Atom, OPDS, Dublin Core, OpenSearch, and Threading namespaces.
3. All user-supplied text values are XML-escaped.
4. All `href` values accept absolute-path URLs (starting with `/`).

## Non-Goals
- OPDS 2.0 (JSON) generation.
- XML parsing or validation libraries.
- Any changes to existing book metadata extraction.

## Design Considerations
- Prefer a small, readable template-literal builder over a heavy XML library.

## Technical Considerations
- Include a shared XML-escape helper for `<`, `>`, `&`, `"`, and `'`.
- Ensure date fields are ISO-8601 strings.

## Success Metrics
- Sample feeds render correctly in an OPDS client without XML parsing errors.

## Open Questions
- Should facet link creation live in the XML helper or in route handlers?
