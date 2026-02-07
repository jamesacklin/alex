# AT Protocol Social Layer for Alex

## The Idea

Alex is currently a self-hosted, single-server library app. Each server admin provisions local user accounts via email/password (NextAuth + SQLite). There is no cross-server communication, no global identity, and no social features.

The goal is to let Alex users have a **global identity** that travels with them across servers, and to use that identity to **find friends, share reading activity, and discover books** --- all without a centralized account service.

AT Protocol is a strong fit because:

1. **A portable, human-readable identity** (`@alice.bsky.social` or `@alice.com`) backed by DIDs and DNS
2. **A federated data network** with typed records, event streams, and built-in data portability
3. **An existing user base** (Bluesky's millions of users) and a mature TypeScript SDK
4. **No new language to learn** --- custom app logic is TypeScript end-to-end

This document lays out a phased plan for integrating AT Protocol into Alex as an alternative to the [Urbit-based approach](./urbit-integration.md).

---

## Background: How AT Protocol Works (Abridged)

### Identity

AT Protocol uses a dual-identifier system:

| Identifier | Example                              | Purpose                                            |
| ---------- | ------------------------------------ | -------------------------------------------------- |
| **DID**    | `did:plc:bv6ggog3tya...`             | Permanent cryptographic identity; never changes    |
| **Handle** | `@alice.bsky.social` or `@alice.com` | Human-readable DNS name; mutable alias for the DID |

A DID resolves to a **DID Document** containing:

- The user's cryptographic signing key
- The URL of their **PDS** (Personal Data Server)
- Their associated handle (for bidirectional verification)

Users can change their handle (even to a custom domain) or migrate their entire account to a different PDS without losing their identity or social graph. The DID stays the same.

Two DID methods are supported:

- **`did:plc`**: Custom method with key rotation, account recovery, and migration. Used by most accounts.
- **`did:web`**: W3C standard using DNS. Simpler, but tied to domain ownership.

### Data Model

Every user has a **data repository** hosted on their PDS --- a Merkle tree of signed records, similar to Git but for structured data.

Records are organized into **collections** identified by reverse-DNS names (**NSIDs**):

```
at://alice.bsky.social/app.bsky.feed.post/3jt5tsakbze2c
     ─────────────────  ──────────────────  ─────────────
     repository (DID)   collection (NSID)   record key
```

**Lexicons** are JSON schemas that define record types, API methods, and subscriptions. Any application can define its own lexicons under a domain it controls:

```json
{
  "lexicon": 1,
  "id": "com.alexreader.shelf.book",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 512 },
          "author": { "type": "string", "maxLength": 256 },
          "isbn": { "type": "string", "maxLength": 20 },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

### Federation

The network has three layers:

```
 Users write to their PDS
          │
          ▼
 ┌─────────────┐      ┌───────────┐      ┌─────────────┐
 │   PDS       │─────►│   Relay   │─────►│  App View   │
 │  (storage)  │      │ (firehose)│      │  (indexer)  │
 └─────────────┘      └───────────┘      └─────────────┘
  "where data          "aggregates         "builds app-
   lives"               all PDSes"          specific views"
```

- **PDS**: Hosts user repos, handles auth, emits per-repo event streams. Lightweight (1 GB RAM, 1 CPU).
- **Relay**: Subscribes to many PDSes, produces a unified firehose of all network events. Resource-intensive.
- **App View**: Subscribes to the relay's firehose, indexes records relevant to its application, serves API queries.

For Alex, the **App View** is the key piece we'd build. It subscribes to the firehose (via Jetstream), filters for our custom lexicon records, and builds our social index.

### Web Integration

The official TypeScript SDK (`@atproto/api`) provides typed access to all protocol operations:

```ts
import { Agent } from "@atproto/api";

const agent = new Agent("https://bsky.social");

// Write a record to the user's repo
await agent.com.atproto.repo.createRecord({
  repo: agent.session.did,
  collection: "com.alexreader.shelf.book",
  record: {
    $type: "com.alexreader.shelf.book",
    title: "Dune",
    author: "Frank Herbert",
    createdAt: new Date().toISOString(),
  },
});

// Read a record
const { data } = await agent.com.atproto.repo.listRecords({
  repo: "did:plc:abc123",
  collection: "com.alexreader.shelf.book",
});
```

OAuth 2.0 (with DPoP + PKCE + PAR) is the standard auth mechanism for third-party apps.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Alex Web App (Next.js)                                      │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐       │
│  │ Library UI  │  │ Social Feed  │  │ Friend Search │       │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘       │
│         │                │                   │               │
│  ┌──────┴────────────────┴───────────────────┴────────────┐  │
│  │              Next.js API Routes                        │  │
│  │  /api/books, /api/collections (existing)               │  │
│  │  /api/atproto/* (new - OAuth, social features)         │  │
│  └──────┬──────────────────────────────────┬──────────────┘  │
│         │                                  │                 │
├─────────┼──────────────────────────────────┼─────────────────┤
│         │ SQLite (existing)                │ AT Proto SDK    │
│         ▼                                  ▼                 │
│  ┌──────────────┐                 ┌────────────────────┐     │
│  │ users, books │                 │ @atproto/api       │     │
│  │ readProgress │                 │ @atproto/oauth-    │     │
│  │ collections  │                 │   client-node      │     │
│  │ + social idx │                 └────────┬───────────┘     │
│  └──────────────┘                          │                 │
│                                            │ HTTPS           │
└────────────────────────────────────────────┼─────────────────┘
                                             │
                    ┌────────────────────────┼──────────────────┐
                    │                        ▼                  │
                    │    ┌──────────────────────────────┐       │
                    │    │  User's PDS                  │       │
                    │    │  (bsky.social or self-hosted) │       │
                    │    │                              │       │
                    │    │  Repository:                 │       │
                    │    │  ├─ com.alexreader.shelf.book │       │
                    │    │  ├─ com.alexreader.activity   │       │
                    │    │  ├─ com.alexreader.follow     │       │
                    │    │  └─ com.alexreader.profile    │       │
                    │    └──────────────┬───────────────┘       │
                    │                   │ event stream          │
                    │                   ▼                       │
                    │    ┌──────────────────────────────┐       │
                    │    │  Jetstream (Bluesky relay)   │       │
                    │    │  wss://jetstream2.us-east.   │       │
                    │    │  bsky.network/subscribe      │       │
                    │    │                              │       │
                    │    │  filter: wantedCollections=  │       │
                    │    │    com.alexreader.*           │       │
                    │    └──────────────┬───────────────┘       │
                    │                   │ filtered events       │
                    │                   ▼                       │
                    │    ┌──────────────────────────────┐       │
                    │    │  Alex App View               │       │
                    │    │  (background worker process) │       │
                    │    │                              │       │
                    │    │  Indexes:                    │       │
                    │    │  - all Alex user profiles    │       │
                    │    │  - follow graph              │       │
                    │    │  - activity feed             │       │
                    │    │  - public shelves            │       │
                    │    └──────────────────────────────┘       │
                    │         AT Protocol Network               │
                    └───────────────────────────────────────────┘
```

The key architectural decision: **Alex's existing SQLite database stays for library management (files, reading progress, local collections). AT Protocol handles only the social/public layer (identity, follows, activity sharing, public shelves).** The Next.js app writes social records to the user's PDS via OAuth and reads aggregated social data from its own App View index.

No sidecar process is required --- the AT Protocol SDK is a TypeScript library that runs inside the existing Next.js app. The App View indexer runs as a background worker (or a separate lightweight process).

---

## Custom Lexicons: `com.alexreader.*`

All Alex-specific data stored in AT Protocol repositories lives under lexicons namespaced to a domain we control. These schemas are published as JSON files and versioned immutably.

### `com.alexreader.profile` (singleton)

Declares that an account participates in the Alex network. Record key is `"self"`.

```json
{
  "displayName": "Alice",
  "bio": "Sci-fi enthusiast. Collecting PKD first editions.",
  "serverUrl": "https://alice-books.example.com",
  "createdAt": "2026-03-01T12:00:00Z"
}
```

### `com.alexreader.shelf.book` (collection)

A book the user wants to publicly list. Metadata only --- never file content.

```json
{
  "title": "Dune",
  "author": "Frank Herbert",
  "isbn": "9780441013593",
  "format": "pdf",
  "pageCount": 412,
  "coverUrl": "https://alice-books.example.com/api/books/42/cover",
  "createdAt": "2026-03-01T12:00:00Z"
}
```

### `com.alexreader.activity` (collection)

A reading milestone the user wants to share.

```json
{
  "type": "finished-reading",
  "book": {
    "title": "Dune",
    "author": "Frank Herbert"
  },
  "createdAt": "2026-03-15T18:30:00Z"
}
```

### `com.alexreader.follow` (collection)

Follows another Alex user. Record key is derived from the subject's DID (like Bluesky's follow model).

```json
{
  "subject": "did:plc:xyz789",
  "createdAt": "2026-03-01T12:00:00Z"
}
```

### `com.alexreader.shelf.list` (collection)

A public collection/shelf.

```json
{
  "name": "Cyberpunk Canon",
  "description": "Essential cyberpunk reading",
  "books": [
    "at://did:plc:abc123/com.alexreader.shelf.book/3jt5tsakbze2c",
    "at://did:plc:abc123/com.alexreader.shelf.book/3jt5tsf9kzh4d"
  ],
  "createdAt": "2026-03-01T12:00:00Z"
}
```

---

## Phase 1: AT Protocol Identity as Login

**Goal**: Let users authenticate to any Alex server using their AT Protocol identity (Bluesky handle or any AT Protocol handle), replacing or supplementing email/password auth.

### OAuth Flow

AT Protocol uses OAuth 2.0 with mandatory DPoP, PKCE, and PAR. The flow:

1. User enters their handle (`@alice.bsky.social` or `@alice.com`)
2. Alex resolves the handle to a DID, then resolves the DID to find the user's PDS
3. Alex fetches the PDS's OAuth metadata (`/.well-known/oauth-authorization-server`)
4. Alex POSTs a Pushed Authorization Request (PAR) to the PDS
5. User is redirected to their PDS to approve the login
6. PDS redirects back with an authorization code
7. Alex exchanges the code for access + refresh tokens (with DPoP proof)
8. Alex creates or looks up a local user record linked to that DID

This is handled by `@atproto/oauth-client-node` using the **Backend for Frontend** pattern: the Next.js server manages tokens; the browser never sees them.

### Client Metadata

Alex publishes its OAuth client metadata at a well-known URL:

```json
// https://my-alex-server.com/.well-known/atproto-client-metadata.json
{
  "client_id": "https://my-alex-server.com/.well-known/atproto-client-metadata.json",
  "application_type": "web",
  "client_name": "Alex Library",
  "dpop_bound_access_tokens": true,
  "grant_types": ["authorization_code", "refresh_token"],
  "redirect_uris": ["https://my-alex-server.com/api/atproto/callback"],
  "response_types": ["code"],
  "scope": "atproto",
  "token_endpoint_auth_method": "private_key_jwt",
  "jwks_uri": "https://my-alex-server.com/.well-known/jwks.json"
}
```

No pre-registration with any PDS is required --- this is a key advantage over traditional OAuth.

### Schema Addition

```
users table:
  + atproto_did     TEXT UNIQUE  -- e.g. "did:plc:bv6ggog3tya..."
  + atproto_handle  TEXT         -- e.g. "alice.bsky.social"
```

### What Stays the Same

- Reading progress, collections, file management, and all existing features work identically
- Admin can still create password-only accounts for users without AT Protocol identities
- SQLite remains the source of truth for library data

### New Dependencies

```
@atproto/api
@atproto/oauth-client-node
@atproto/syntax
```

All TypeScript. No new runtime, no sidecar container, no new language.

---

## Phase 2: Follow Graph

**Goal**: Users can follow each other by handle. Unlike the Urbit plan's mutual friendships, AT Protocol follows are **unidirectional** (like Twitter/Bluesky), which is simpler and more natural for "see what someone is reading."

### Follow Mechanics

When Alice follows Bob:

1. Alex writes a `com.alexreader.follow` record to Alice's PDS repository:
   ```
   at://did:plc:alice/com.alexreader.follow/3jt5tsakbze2c
   → { subject: "did:plc:bob", createdAt: "..." }
   ```
2. This record propagates through the relay firehose
3. The Alex App View indexes the follow and updates its social graph
4. Bob's activity now appears in Alice's feed

Unfollowing deletes the record. No acceptance step needed.

### Profile Creation

When a user first connects their AT Protocol identity to Alex, the app writes a `com.alexreader.profile` record to their PDS:

```
at://did:plc:alice/com.alexreader.profile/self
→ { displayName: "Alice", serverUrl: "https://alice-books.com", ... }
```

This singleton record signals to the App View that this DID is an Alex user, enabling discovery.

### Discovery

Because AT Protocol data is public by default, the App View can maintain a directory of all Alex users (everyone with a `com.alexreader.profile` record). This enables:

- **Search by handle**: type `@bob` and find Bob's Alex profile
- **Browse Alex users**: see a directory of everyone using Alex on the network
- **Suggested follows**: "People who read similar books"

This solves the Urbit plan's open question about discovery without centralization --- the App View naturally indexes all participants.

### Next.js Integration

```
POST /api/atproto/follow          → createRecord(com.alexreader.follow)
DELETE /api/atproto/follow/:rkey  → deleteRecord(com.alexreader.follow)
GET  /api/atproto/following       → query App View index
GET  /api/atproto/followers       → query App View index
GET  /api/atproto/profile/:handle → resolve handle, fetch profile record
GET  /api/atproto/discover        → query App View for Alex users
```

---

## Phase 3: Activity Sharing

**Goal**: Followers can see what you're reading, finishing, and adding to shelves.

### Activity Records

When a user performs certain actions in Alex, the Next.js backend writes an `com.alexreader.activity` record to their PDS:

```ts
await agent.com.atproto.repo.createRecord({
  repo: session.did,
  collection: "com.alexreader.activity",
  record: {
    $type: "com.alexreader.activity",
    type: "finished-reading",
    book: {
      title: "Dune",
      author: "Frank Herbert",
    },
    createdAt: new Date().toISOString(),
  },
});
```

Activity types:

- `started-reading` --- user began a new book
- `finished-reading` --- user completed a book
- `added-to-shelf` --- user added a book to a public shelf
- `added-to-library` --- a new book appeared in the user's library

### App View Indexer

A background worker subscribes to Jetstream, filtered to `com.alexreader.*` collections:

```ts
const ws = new WebSocket(
  "wss://jetstream2.us-east.bsky.network/subscribe?" +
    "wantedCollections=com.alexreader.activity&" +
    "wantedCollections=com.alexreader.follow&" +
    "wantedCollections=com.alexreader.profile&" +
    "wantedCollections=com.alexreader.shelf.book&" +
    "wantedCollections=com.alexreader.shelf.list",
);

ws.on("message", (data) => {
  const event = JSON.parse(data);
  // Index into SQLite: activities, follows, profiles, books
});
```

This worker ingests every Alex-related event on the network and builds a local index. The social feed is then a simple database query: "get activities from DIDs that this user follows, ordered by time."

### Privacy Controls

AT Protocol repository records are **public by default**. Privacy is handled by omission:

- **Per-book opt-out**: books marked as private in SQLite are simply never written to the PDS
- **Activity type toggles**: the Next.js backend checks user preferences before creating activity records
- **Private collections**: collections marked private in SQLite are never published as `com.alexreader.shelf.list` records
- **Reading progress**: stays entirely in SQLite --- never touches AT Protocol

This is a simpler privacy model than the Urbit approach: instead of encrypting or access-controlling data, you just don't publish it.

### Web UI: Social Feed

A new page (`/social` or `/feed`) that queries the App View index:

```
@alice.bsky.social finished reading "Dune" by Frank Herbert     2 hours ago
@bob.example.com   started reading "Neuromancer" by W. Gibson   5 hours ago
@carol.bsky.social added "Snow Crash" to shelf "Cyberpunk"      1 day ago
```

---

## Phase 4: Cross-Server Book Discovery

**Goal**: Browse friends' public shelves and discover books through the social graph.

### Public Shelves via AT Protocol

Unlike the Urbit plan, which requires a custom unauthenticated API on each server, AT Protocol gives us this for free. Every user's `com.alexreader.shelf.book` and `com.alexreader.shelf.list` records are publicly readable from their PDS:

```ts
// Read anyone's public book list --- no auth required
const { data } = await agent.com.atproto.repo.listRecords({
  repo: "did:plc:bob",
  collection: "com.alexreader.shelf.book",
  limit: 50,
});
```

The App View also indexes all public shelves, enabling:

- **Browse a user's shelves**: see all public collections for any Alex user
- **Search across the network**: "Who has Neuromancer on their shelf?"
- **Popular books**: "Most-shelved books this month"

### "Want to Read" / Wishlists

When you see a book on someone's shelf that you don't have:

- Add it to a local **"Want to Read"** list (stored in SQLite)
- Optionally publish it as a `com.alexreader.shelf.list` record (a public wishlist)
- If the book later appears in your library (via the file watcher), it auto-matches by ISBN or title/author

No files are ever transferred --- only metadata records.

### Server URL Discovery

Each user's `com.alexreader.profile` record includes their `serverUrl`. If their Alex server exposes a public cover image endpoint, the social feed can display cover thumbnails inline. If the server is unreachable, the feed gracefully degrades to text-only.

---

## Phase 5: Reading Groups

**Goal**: Groups of users can read a book together, with shared progress tracking and discussion.

### Approach: Lightweight Records, Not Full Group Infrastructure

Unlike Urbit (which has a built-in `%groups` agent), AT Protocol doesn't have native group primitives. Rather than building heavy group infrastructure, reading groups can be modeled as a simple record type with a coordinator pattern.

### `com.alexreader.group` (collection)

The group creator publishes a group record:

```json
{
  "name": "Dune Book Club",
  "book": {
    "title": "Dune",
    "author": "Frank Herbert"
  },
  "members": ["did:plc:alice", "did:plc:bob", "did:plc:carol"],
  "paceTarget": {
    "chapter": 5,
    "deadline": "2026-04-01T00:00:00Z"
  },
  "createdAt": "2026-03-01T12:00:00Z"
}
```

### `com.alexreader.group.post` (collection)

Discussion posts within a reading group:

```json
{
  "group": "at://did:plc:alice/com.alexreader.group/3jt5tsakbze2c",
  "text": "The ecology of Arrakis is more interesting than the politics.",
  "chapter": 3,
  "createdAt": "2026-03-10T14:30:00Z"
}
```

### Reading Group Features

- **Shared progress**: each member's reading progress (from their Alex server, via `serverUrl`) is displayed alongside the group view
- **Chapter discussions**: posts are tagged with chapter numbers; the App View indexes and groups them
- **Pace suggestions**: the group record includes an optional `paceTarget`
- **Spoiler protection**: the UI hides discussion posts for chapters ahead of the viewer's current progress (checked against their local reading progress in SQLite)

### Limitations

This is simpler than the Urbit approach, which gets real-time P2P messaging for free via Gall subscriptions. AT Protocol reading groups are closer to a forum model --- eventually consistent, with the App View indexing discussion posts from across the network. Real-time chat would require a separate WebSocket layer or integration with an existing AT Protocol chat app.

---

## Technical Considerations

### TypeScript All the Way Down

Unlike the Urbit plan (which requires learning Hoon), every component is TypeScript:

- Custom lexicon schemas: JSON files
- OAuth integration: `@atproto/oauth-client-node`
- PDS reads/writes: `@atproto/api`
- App View indexer: a Node.js WebSocket worker
- UI components: React (same as existing Alex)

This dramatically reduces the barrier to entry.

### App View Hosting

The App View indexer is the only new infrastructure. Options:

1. **Embedded in Alex** (simplest): the Jetstream WebSocket listener runs as a background worker inside the Next.js process (or a child process). Social index tables live in the existing SQLite database. Suitable for small-scale deployments.

2. **Separate service** (scales better): the indexer runs as a standalone Node.js process with its own database. Can be horizontally scaled. Suitable if the Alex network grows large.

3. **Community-run App View**: if Alex gains adoption, a shared App View could be run by the community, similar to how Bluesky operates `api.bsky.app`. Individual Alex servers could query this shared service instead of running their own indexer.

### Data Sovereignty

Same principle as the Urbit plan: **AT Protocol stores only public social data** (profile, follows, activity, public shelves). It never stores:

- Book files (stay on the local filesystem)
- Reading progress (stays in SQLite)
- Private collections (stay in SQLite)
- User passwords or session tokens (stay in SQLite/NextAuth)

If the AT Protocol integration goes down, the library works perfectly. If the Alex server goes down, the user's AT Protocol identity, follows, and public shelves persist on their PDS.

### Public by Default

AT Protocol repository records are publicly readable. This is the biggest philosophical difference from Urbit (where data can be access-controlled per-ship). Implications:

- **Good**: discovery is trivial; anyone can browse anyone's public shelves
- **Good**: no need for complex permission systems on the protocol layer
- **Trade-off**: users must actively choose what to publish; the default should be "don't publish" with opt-in sharing
- **Mitigation**: private data stays in SQLite, never written to the PDS

### Relationship to Bluesky

Alex users don't need a Bluesky account specifically --- they need any AT Protocol identity (any PDS). However, most users will already have a Bluesky account, which means:

- **Zero onboarding friction**: "Log in with your Bluesky account" is immediately understandable
- **Cross-pollination**: a user could share an Alex activity record as a Bluesky post (embedding the AT URI)
- **Handle portability**: if a user already has `@alice.com` as their Bluesky handle, they get that same identity in Alex for free

### Self-Hosted PDS

For server admins who want full sovereignty, running a PDS is straightforward:

- 1 GB RAM, 1 CPU core, 20 GB SSD
- Automated installer with Docker + Caddy (auto-TLS)
- Supports 1--20 users per instance
- Users on a self-hosted PDS get handles like `@alice.my-books.com`

This is lighter-weight than running an Urbit ship (which requires booting and maintaining an entire OS-level VM).

---

## Comparison with Urbit Approach

| Dimension                | Urbit                                        | AT Protocol                                       |
| ------------------------ | -------------------------------------------- | ------------------------------------------------- |
| **Identity**             | `~firbyr-napbes` (phonemic, Ethereum PKI)    | `@alice.bsky.social` (DNS, DID-based)             |
| **Onboarding**           | Need a planet (free but unfamiliar) or comet | "Log in with Bluesky" (millions already have one) |
| **Networking**           | True P2P (Ames, encrypted ship-to-ship)      | Federated (PDS → Relay → App View)                |
| **Privacy model**        | Per-ship access control (granular)           | Public by default (privacy via omission)          |
| **Real-time**            | Native (subscriptions are live P2P streams)  | Eventually consistent (firehose indexing)         |
| **Development language** | Hoon (steep learning curve)                  | TypeScript (familiar)                             |
| **Infrastructure**       | Sidecar Urbit container required             | No sidecar; SDK is a library                      |
| **Ecosystem size**       | Small (thousands)                            | Large (millions on Bluesky alone)                 |
| **Data portability**     | Ship is portable (but ecosystem is small)    | DID is portable across any PDS                    |
| **Discovery**            | Hard (no global index)                       | Easy (App View indexes all participants)          |
| **Group chat**           | Built-in (`%groups` agent)                   | Must build or integrate separately                |
| **Offline resilience**   | Ship stores everything locally               | PDS is always-online server                       |

**AT Protocol wins on**: developer experience, user onboarding, ecosystem size, discoverability.

**Urbit wins on**: true P2P (no relay dependency), granular privacy, real-time communication, built-in group infrastructure.

---

## Migration Path

The phased approach means each phase is independently useful:

| Phase             | Value Without Later Phases                                      |
| ----------------- | --------------------------------------------------------------- |
| 1. Identity       | "Log in with Bluesky"; your handle works on any Alex server     |
| 2. Follows        | See who else uses Alex; discover readers with similar taste     |
| 3. Activity       | Know what friends are reading; browseable from any AT Proto app |
| 4. Discovery      | Find books through the social graph; network-wide search        |
| 5. Reading Groups | Book clubs with chapter discussions and pace tracking           |

Each phase can ship independently. Phase 1 gives immediate value --- a user with a Bluesky account can log in to any Alex server without the admin creating an account for them.

---

## Open Questions

- **Namespace domain**: We need a stable domain for the `com.alexreader.*` lexicons. Once published, lexicon NSIDs are immutable. Should this be tied to the project's domain, or a dedicated schema domain?
- **App View cost**: If the Alex network grows, the App View indexer needs to process every relevant event on the entire AT Protocol network. At what scale does this become expensive, and should we plan for a community-run shared App View from the start?
- **Bluesky cross-posting**: Should finishing a book optionally create a Bluesky post? This would be great for visibility but mixes the `app.bsky.*` and `com.alexreader.*` namespaces.
- **Real-time features**: AT Protocol's eventually-consistent model works for activity feeds but not for live reading group discussions. Should we use a separate WebSocket layer for real-time chat, or accept the forum-like latency?
- **Record cleanup**: Activity records accumulate in user repositories forever. Should Alex periodically delete old activity records, or let them grow? AT Protocol repos are designed for growth, but there's no built-in TTL.
