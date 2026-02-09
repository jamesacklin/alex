# Plan: OPDS Feed Support

## Summary

Expose the Alex library and shared collections as [OPDS 1.2](https://specs.opds.io/opds-1.2.html) catalogs so users can browse and download books from any OPDS-compatible reading app (Calibre, KOReader, Thorium Reader, Foliate, Moon+ Reader, etc.) without using the web UI.

Two catalog types:

1. **Authenticated catalog** -- a user's full library and personal collections, protected by HTTP Basic Auth (with an optional API-key-in-URL fallback).
2. **Public catalog** -- any shared collection, accessible via its existing share token with no authentication required.

---

## Background: OPDS in Brief

OPDS (Open Publication Distribution System) is an Atom-based syndication format for electronic publications. An OPDS catalog is a tree of XML feeds:

- **Navigation Feeds** create a browsable hierarchy (e.g. "My Library" > "Collections" > "Sci-Fi").
- **Acquisition Feeds** list books as Atom entries, each with acquisition links (download URLs) and metadata (title, author, cover, format).
- **Search** is supported via OpenSearch description documents.
- **Pagination** uses RFC 5005 `next`/`previous` link relations.
- **Facets** allow filtering and sorting within an acquisition feed.

Media types:

| Type | Value |
|------|-------|
| Navigation Feed | `application/atom+xml;profile=opds-catalog;kind=navigation` |
| Acquisition Feed | `application/atom+xml;profile=opds-catalog;kind=acquisition` |
| Catalog Entry | `application/atom+xml;type=entry;profile=opds-catalog` |

Since Alex is a personal library (not a store), all acquisition links use the `http://opds-spec.org/acquisition/open-access` relation -- no purchase, borrow, or subscription flows.

---

## Design Decisions

### Authentication strategy

OPDS client support for authentication was researched extensively. The findings:

| Client | Platform | Auth Methods | Notes |
|--------|----------|-------------|-------|
| Calibre | Desktop | HTTP Basic | Built-in content server + plugin |
| KOReader | E-ink | HTTP Basic only | No Digest, no OAuth |
| Thorium Reader | Desktop | Basic, OAuth | Cross-domain token bug with OAuth |
| Foliate | Linux | HTTP Basic | Credential persistence bug in some versions |
| Moon+ Reader | Android | HTTP Basic | Unreliable; fails with special chars in passwords |
| Librera | Android | HTTP Basic | HTTPS + auth has reported bugs |
| Cantook/Aldiko | Mobile | Basic, OAuth | Full Authentication for OPDS spec support |

**Conclusion: HTTP Basic Auth over TLS is the only method supported by every OPDS client.** OAuth is only viable for Readium-based clients (Thorium, Cantook). The formal "Authentication for OPDS 1.0" spec mandates HTTP Basic as the baseline.

Alex will support two authentication mechanisms for OPDS:

#### 1. HTTP Basic Auth (primary)

The OPDS endpoints accept standard `Authorization: Basic <base64(email:password)>` headers. When credentials are missing or invalid, the server responds with `401 Unauthorized` and a `WWW-Authenticate: Basic realm="Alex"` header.

This works with every OPDS client tested. The server validates credentials directly against the `users` table using the existing bcrypt password hash -- no session/JWT needed.

#### 2. API key in URL path (fallback)

Some clients (Moon+ Reader, older Librera builds, e-reader built-in browsers) have broken or missing HTTP auth support. As a fallback, each user gets a per-user OPDS API key (a `crypto.randomUUID()`) that can be embedded in the catalog URL:

```
https://alex.example.com/opds/{apiKey}/catalog
```

This sidesteps client-side auth entirely. The key is generated on demand, visible in the user's settings page, and can be regenerated (which invalidates the old key). Servers like Kavita and Stump use this same pattern.

Both methods are supported simultaneously. Basic Auth is checked first; if no `Authorization` header is present, the URL path is checked for an API key segment.

### Public collection feeds

Shared collections already have unguessable share tokens and unauthenticated API endpoints. The OPDS feed for a shared collection lives at:

```
/opds/shared/{shareToken}
```

No authentication required -- consistent with the existing `/shared/{token}` and `/api/shared/{token}` routes. The feed returns the same books that the public web view shows, with acquisition links pointing to the existing public file-serving endpoints.

### Feed structure

```
Authenticated:
/opds/v1.2/catalog                    Root (Navigation Feed)
├── /opds/v1.2/new                    Recently Added (Acquisition Feed)
├── /opds/v1.2/all                    All Books (Acquisition Feed, paginated)
├── /opds/v1.2/collections            My Collections (Navigation Feed)
│   └── /opds/v1.2/collections/{id}   Collection Books (Acquisition Feed)
└── /opds/v1.2/search                 OpenSearch Description
    └── /opds/v1.2/search?q={term}    Search Results (Acquisition Feed)

Public:
/opds/shared/{token}                  Shared Collection (Acquisition Feed)
└── /opds/shared/{token}/search       Search within collection
    └── /opds/shared/{token}/search?q={term}
```

The `/opds/v1.2/` prefix is versioned so a future OPDS 2.0 (JSON-based) implementation can coexist at `/opds/v2/`. When an API key is used, it is inserted before the version: `/opds/{apiKey}/v1.2/catalog`.

### What each book entry contains

```xml
<entry>
  <title>Book Title</title>
  <id>urn:uuid:{bookId}</id>
  <updated>2025-01-15T00:00:00Z</updated>
  <author><name>Author Name</name></author>
  <content type="text">Book description if available</content>
  <dc:language>en</dc:language>
  <link rel="http://opds-spec.org/image"
        href="/opds/v1.2/books/{id}/cover" type="image/png"/>
  <link rel="http://opds-spec.org/image/thumbnail"
        href="/opds/v1.2/books/{id}/cover" type="image/png"/>
  <link rel="http://opds-spec.org/acquisition/open-access"
        href="/opds/v1.2/books/{id}/file" type="application/pdf"/>
  <!-- or type="application/epub+zip" for EPUBs -->
</entry>
```

For public feeds, the links point to the existing public endpoints (`/api/shared/{token}/books/{bookId}/file`, etc.) to reuse the share-token scoping logic.

### No OPDS 2.0 (yet)

OPDS 2.0 uses JSON (based on Readium Web Publication Manifest) instead of Atom XML. Client support is limited to Readium-based apps (Thorium, Cantook). Since the goal is maximum client compatibility, this plan targets OPDS 1.2 only. The versioned URL prefix (`/v1.2/`) leaves room for a future OPDS 2.0 implementation.

---

## Implementation Steps

### Phase 1: Database -- add OPDS API key to users

**File:** `src/lib/db/schema.ts`

Add one column to the `users` table:

```ts
opdsApiKey: text("opds_api_key").unique(),  // nullable, generated on demand
```

The key is `null` by default. It is generated the first time the user visits their OPDS settings or explicitly requests a key. This avoids generating keys for users who never use OPDS.

**Migration:** Generate via `pnpm drizzle-kit generate`. Nullable column, no data loss.

### Phase 2: OPDS authentication middleware

**File:** `src/lib/opds/auth.ts` (new)

A middleware function used by all authenticated OPDS route handlers:

```ts
export async function authenticateOpdsRequest(
  request: Request,
  params?: { apiKey?: string }
): Promise<User | null>
```

Logic:
1. Check `params.apiKey` -- if present, look up user by `opdsApiKey`.
2. Check `Authorization` header -- if `Basic`, decode and validate email + password against the `users` table using bcrypt.
3. If neither succeeds, return `null` (caller returns 401).

This function queries the database directly (no NextAuth session needed) because OPDS clients do not support cookies or JWTs.

### Phase 3: Atom XML builder utilities

**File:** `src/lib/opds/xml.ts` (new)

Helper functions to generate valid Atom/OPDS XML:

- `buildNavigationFeed(opts)` -- generates a navigation feed document with `<entry>` elements linking to sub-feeds.
- `buildAcquisitionFeed(opts)` -- generates an acquisition feed with book entries, pagination links, and facet links.
- `buildEntry(book, opts)` -- generates a single `<entry>` element for a book with acquisition links, cover links, and Dublin Core metadata.
- `buildOpenSearchDescription(opts)` -- generates an OpenSearch XML document.

All functions return XML strings. Use a lightweight XML builder (or template literals -- the structure is simple and fixed enough that a full XML library is unnecessary).

Namespaces included in the root element:

```xml
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:thr="http://purl.org/syndication/thread/1.0">
```

### Phase 4: Authenticated OPDS route handlers

All routes return `Content-Type: application/atom+xml;profile=opds-catalog;kind=navigation` or `kind=acquisition` as appropriate.

#### Root Navigation Feed

**File:** `src/app/api/opds/v1.2/catalog/route.ts` (new)
**Also:** `src/app/api/opds/[apiKey]/v1.2/catalog/route.ts` (new, same handler)

`GET /opds/v1.2/catalog` -- returns a navigation feed with entries linking to:

| Title | Relation | Target |
|-------|----------|--------|
| All Books | `subsection` | `/opds/v1.2/all` |
| Recently Added | `http://opds-spec.org/sort/new` | `/opds/v1.2/new` |
| Collections | `subsection` | `/opds/v1.2/collections` |

Includes `<link rel="search">` pointing to the OpenSearch description.
Includes `<link rel="self">` and `<link rel="start">`.

#### All Books Acquisition Feed

**File:** `src/app/api/opds/v1.2/all/route.ts` (new)

`GET /opds/v1.2/all` -- paginated acquisition feed of every book in the library, ordered by title. Supports `?page` query param. Default page size: 50.

Includes facet links for sorting (title, author, recently added) and filtering (PDF only, EPUB only).

#### Recently Added Acquisition Feed

**File:** `src/app/api/opds/v1.2/new/route.ts` (new)

`GET /opds/v1.2/new` -- acquisition feed of the 50 most recently added books, ordered by `addedAt` descending. No pagination (single page).

#### Collections Navigation Feed

**File:** `src/app/api/opds/v1.2/collections/route.ts` (new)

`GET /opds/v1.2/collections` -- navigation feed listing the authenticated user's collections. Each entry links to the collection's acquisition feed.

#### Collection Acquisition Feed

**File:** `src/app/api/opds/v1.2/collections/[id]/route.ts` (new)

`GET /opds/v1.2/collections/{id}` -- paginated acquisition feed of books in the specified collection. Validates the collection belongs to the authenticated user.

#### Search

**File:** `src/app/api/opds/v1.2/search/route.ts` (new)

Two behaviors based on query params:

- `GET /opds/v1.2/search` (no `q` param) -- returns the OpenSearch Description Document (`application/opensearchdescription+xml`).
- `GET /opds/v1.2/search?q={term}` -- returns an acquisition feed of search results, matching against title and author (same search logic as the existing `/api/books?q=` endpoint).

#### Book file and cover endpoints

**File:** `src/app/api/opds/v1.2/books/[id]/file/route.ts` (new)
**File:** `src/app/api/opds/v1.2/books/[id]/cover/route.ts` (new)

These endpoints authenticate the request and then proxy to the same file-serving logic as the existing `/api/books/[id]/file` and `/api/books/[id]/cover` routes. They exist under the `/opds/` path so that:

1. Auth can be handled uniformly (Basic Auth / API key instead of JWT session).
2. OPDS clients that only send credentials to the catalog's origin path still authenticate correctly.

The API-key variants (`/opds/{apiKey}/v1.2/books/...`) also resolve to the same handlers.

### Phase 5: Public OPDS route handlers

#### Shared Collection Feed

**File:** `src/app/api/opds/shared/[token]/route.ts` (new)

`GET /opds/shared/{token}` -- unauthenticated acquisition feed for a shared collection. Uses the existing `getSharedCollection(token)` helper to validate the token. Returns book entries with acquisition links pointing to the existing public file endpoints (`/api/shared/{token}/books/{bookId}/file`).

Includes `<link rel="search">` pointing to `/opds/shared/{token}/search`.

#### Shared Collection Search

**File:** `src/app/api/opds/shared/[token]/search/route.ts` (new)

Same dual behavior as the authenticated search -- returns OpenSearch description or search results filtered to the shared collection's books.

### Phase 6: Middleware updates

**File:** `src/middleware.ts`

Add an exemption for all `/opds/` routes so they bypass NextAuth session checks:

```ts
if (nextUrl.pathname.startsWith("/opds/")) {
  return NextResponse.next();
}
```

The OPDS routes handle their own authentication (Basic Auth / API key / share token) independently of the NextAuth middleware.

### Phase 7: User settings UI -- OPDS configuration

**File:** `src/app/(dashboard)/settings/page.tsx` (new or extend existing)

Add an "OPDS" section to user settings:

- Display the user's OPDS catalog URL (`https://{host}/opds/v1.2/catalog`).
- Display the API-key URL variant (`https://{host}/opds/{apiKey}/v1.2/catalog`), with the key masked by default and a "Show" toggle.
- "Generate Key" button (if no key exists) / "Regenerate Key" button (if key exists, with confirmation dialog warning that existing clients will need to be reconfigured).
- "Copy URL" buttons for both variants.
- Brief instructions: "Add this URL to your OPDS reader app (Calibre, KOReader, Thorium, etc.)."

### Phase 8: OPDS discovery headers

**File:** `src/app/layout.tsx` (modify)

Add an HTML `<link>` tag for OPDS auto-discovery on the public-facing pages:

```html
<link rel="alternate"
      type="application/atom+xml;profile=opds-catalog"
      title="Alex OPDS Catalog"
      href="/opds/v1.2/catalog" />
```

For shared collection pages (`/shared/{token}`), add:

```html
<link rel="alternate"
      type="application/atom+xml;profile=opds-catalog"
      title="Shared Collection"
      href="/opds/shared/{token}" />
```

---

## OPDS Client Compatibility Notes

### Tested/expected to work

- **Calibre**: Add catalog URL in Preferences > Sharing > OPDS. Supports Basic Auth natively. API-key URL also works.
- **KOReader**: Add catalog in OPDS Catalog menu. Enter email/password when prompted. API-key URL recommended for reliability.
- **Thorium Reader**: Add OPDS feed URL. Basic Auth login dialog appears automatically.
- **Foliate**: Add catalog URL. Prompted for credentials on first access.

### Known client quirks to accommodate

1. **Moon+ Reader** may not send credentials for sub-resource requests (covers, downloads). The API-key-in-URL approach sidesteps this entirely because the key is part of every URL the client follows.
2. **Librera** has HTTPS + Basic Auth bugs in some versions. API-key URL is the recommended workaround.
3. **Some clients strip the path prefix** when following relative links. All `href` attributes in feed entries should use absolute paths (starting with `/opds/...`).
4. **Cover images**: Some clients only request `image/jpeg`. Alex generates PNG covers. The cover endpoint should set `Content-Type` based on the actual file, and the entry should declare the correct type. Consider generating JPEG covers in a future enhancement.
5. **Special characters in passwords**: Moon+ Reader and some other clients fail with special characters. Document this limitation for users.

### Recommendations for users

- Use the API-key URL if your client has authentication issues.
- Ensure Alex is served over HTTPS (required for secure Basic Auth).
- If covers don't load, try the API-key URL variant.
- Regenerate your API key if you suspect it has been compromised.

---

## Security Considerations

### Authentication

1. **HTTP Basic Auth must be used over TLS only.** Credentials are base64-encoded (not encrypted). Without TLS, they are transmitted in cleartext. Alex should warn in the OPDS settings UI if the site is not served over HTTPS.
2. **Bcrypt validation on every request.** Basic Auth sends credentials with every request. Bcrypt is intentionally slow (~100ms per hash). This is acceptable for OPDS because clients make few requests (feed fetch + a handful of downloads), but it does mean the server should not be used as a high-throughput API. If performance becomes an issue, a short-lived in-memory credential cache (keyed by email, TTL 60s) could be added later.
3. **API keys are equivalent to passwords.** They grant full read access to the user's library. They are stored as plaintext in the database (unlike passwords) because they need to be displayed to the user and matched by exact comparison. If an API key is compromised, the user can regenerate it.
4. **API keys in URLs are logged.** Server access logs, reverse proxy logs, and browser history will contain the API key. Document this trade-off. The key is per-user and revocable, limiting blast radius.
5. **No write operations.** The OPDS endpoints are read-only. There is no way to modify books, collections, or settings through OPDS. This limits the impact of a compromised API key to data exfiltration of the user's own library.

### Public feeds

1. **Share token scoping is unchanged.** Public OPDS feeds use the same `getSharedCollection()` and `getSharedBook()` helpers as the existing public web UI. A share token cannot be used to access books outside the shared collection.
2. **No enumeration.** There is no public endpoint that lists all shared collections. You must know the share token to access a feed.
3. **Revocation works instantly.** When a user disables sharing (sets `shareToken = null`), the OPDS feed returns 404 immediately.
4. **OPDS feeds expose the same data as the web UI.** No additional metadata is leaked. The owner's identity remains hidden.

### Feed content safety

1. **XML injection.** Book titles, authors, and descriptions are user-influenced (extracted from PDF/EPUB metadata). All text content must be XML-escaped before inclusion in Atom feeds. Use proper escaping for `<`, `>`, `&`, `"`, and `'`.
2. **XXE prevention.** Alex generates XML but does not parse external XML. No XXE risk on the server side. Clients parse the feeds, but that is their responsibility.
3. **Content-Type headers.** All feeds set the correct OPDS media type. This prevents browsers from misinterpreting feeds as HTML (which could enable XSS if book metadata contained script tags).

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/lib/db/schema.ts` | Modify | Add `opdsApiKey` column to `users` |
| `src/lib/db/migrations/` | Generate | Migration for schema change |
| `src/lib/opds/auth.ts` | Create | OPDS authentication (Basic Auth + API key) |
| `src/lib/opds/xml.ts` | Create | Atom/OPDS XML builder utilities |
| `src/app/api/opds/v1.2/catalog/route.ts` | Create | Root navigation feed |
| `src/app/api/opds/[apiKey]/v1.2/catalog/route.ts` | Create | Root navigation feed (API key variant) |
| `src/app/api/opds/v1.2/all/route.ts` | Create | All books acquisition feed |
| `src/app/api/opds/v1.2/new/route.ts` | Create | Recently added acquisition feed |
| `src/app/api/opds/v1.2/collections/route.ts` | Create | Collections navigation feed |
| `src/app/api/opds/v1.2/collections/[id]/route.ts` | Create | Collection acquisition feed |
| `src/app/api/opds/v1.2/search/route.ts` | Create | Search (OpenSearch + results) |
| `src/app/api/opds/v1.2/books/[id]/file/route.ts` | Create | Authenticated book file download |
| `src/app/api/opds/v1.2/books/[id]/cover/route.ts` | Create | Authenticated book cover |
| `src/app/api/opds/[apiKey]/v1.2/[...path]/route.ts` | Create | Catch-all to proxy API-key requests to standard handlers |
| `src/app/api/opds/shared/[token]/route.ts` | Create | Public collection acquisition feed |
| `src/app/api/opds/shared/[token]/search/route.ts` | Create | Public collection search |
| `src/middleware.ts` | Modify | Exempt `/opds/` from NextAuth |
| `src/app/(dashboard)/settings/page.tsx` | Create/Modify | OPDS settings UI section |
| `src/app/layout.tsx` | Modify | OPDS auto-discovery `<link>` tag |

---

## Route Map

### Authenticated OPDS (Basic Auth or API key)

| Route | Type | Description |
|-------|------|-------------|
| `GET /opds/v1.2/catalog` | Navigation Feed | Catalog root |
| `GET /opds/v1.2/all` | Acquisition Feed | All books (paginated) |
| `GET /opds/v1.2/new` | Acquisition Feed | Recently added (latest 50) |
| `GET /opds/v1.2/collections` | Navigation Feed | User's collections |
| `GET /opds/v1.2/collections/{id}` | Acquisition Feed | Books in a collection |
| `GET /opds/v1.2/search` | OpenSearch | Search description document |
| `GET /opds/v1.2/search?q={term}` | Acquisition Feed | Search results |
| `GET /opds/v1.2/books/{id}/file` | Binary | Book file download |
| `GET /opds/v1.2/books/{id}/cover` | Image | Book cover image |

All routes above also work with the API key prefix: `/opds/{apiKey}/v1.2/...`

### Public OPDS (no auth, share token)

| Route | Type | Description |
|-------|------|-------------|
| `GET /opds/shared/{token}` | Acquisition Feed | Shared collection books |
| `GET /opds/shared/{token}/search` | OpenSearch | Search description |
| `GET /opds/shared/{token}/search?q={term}` | Acquisition Feed | Search within collection |

Public book files and covers use the existing `/api/shared/{token}/...` endpoints (already implemented).

---

## Out of Scope

- **OPDS 2.0 (JSON feeds)** -- limited client support today; can be added later at `/opds/v2/`.
- **OPDS PSE (Page Streaming Extension)** -- for page-by-page image streaming (manga/comics); not relevant for PDF/EPUB.
- **Borrowing / lending flows** -- Alex is a personal library, not a lending library.
- **DRM / LCP integration** -- no DRM system.
- **Write operations via OPDS** -- the spec is read-only; no book uploads or collection editing.
- **Rate limiting** -- can be added later if public feeds are abused.
- **Multi-format entries** -- if a book exists in both PDF and EPUB, it appears as two separate entries (matching the existing Alex data model where each file is a separate book record).
- **OPDS bundles / grouped feeds** -- no plans for hierarchical subject/genre navigation beyond collections.
- **Per-collection OPDS URLs for authenticated users** -- users can browse their collections through the navigation hierarchy; direct deep links to authenticated collection feeds could be added later.

---

## Open Questions

1. **Should the "All Books" feed be available only to admins, or to all users?** Currently the Alex library is shared across all users (there is no per-user library scoping). Every authenticated user sees the same books. If per-user libraries are added later, the OPDS feed would need to be scoped accordingly.
2. **Cover format**: OPDS entries declare cover type as `image/png` (Alex's current format). Some clients may prefer JPEG. Should we add on-the-fly PNG-to-JPEG conversion, or is this a non-issue in practice?
3. **Pagination page size**: 50 items per page is a reasonable default. Should this be configurable per-user or is a fixed value sufficient?
