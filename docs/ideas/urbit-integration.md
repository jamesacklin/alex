# Urbit-Backed Social Layer for Alex

## The Idea

Alex is currently a self-hosted, single-server library app. Each server admin provisions local user accounts via email/password (NextAuth + SQLite). There is no cross-server communication, no global identity, and no social features.

The goal is to let Alex users have a **global identity** that travels with them across servers, and to use that identity to **find friends, share reading activity, and discover books** --- all without a centralized account service.

Urbit is a natural fit because it provides exactly the three things we need and nothing we don't:

1. **A self-sovereign, human-readable identity** (`~firbyr-napbes`) backed by Ethereum PKI
2. **Encrypted peer-to-peer messaging** between ships with no central relay
3. **A pub/sub application model** (Gall agents) for building social features on top of that identity layer

This document lays out a phased plan for integrating Urbit into Alex.

---

## Background: How Urbit Works (Abridged)

### Identity

Every Urbit user owns a **ship** --- a cryptographic identity with a pronounceable name. Ships come in ranks:

| Rank       | Example                        | Purpose                                |
| ---------- | ------------------------------ | -------------------------------------- |
| Galaxy     | `~syd`                         | Root infrastructure (256 total)        |
| Star       | `~delsym`                      | Mid-level infra, spawns planets (~65K) |
| **Planet** | `~firbyr-napbes`               | Individual user identity (~4B)         |
| Moon       | `~dabnev-nisseb-nomlec-sormug` | Device/bot identity, owned by a planet |
| Comet      | (long name)                    | Free, anonymous, disposable            |

A **planet** is the identity tier that matters for Alex users. It is scarce enough to resist spam, memorable enough to share verbally, and cryptographically self-sovereign (keys live on Ethereum via the Azimuth contracts). Planets can be obtained for free via Tlon's Layer 2 roller.

### Networking

Ships communicate through **Gall agents** --- long-running userspace applications. Three primitives:

- **Poke**: fire-and-forget message (command) with an ack/nack
- **Subscription**: persistent pub/sub stream of facts (events)
- **Scry**: synchronous read-only query

All traffic is end-to-end encrypted via the **Ames** vane using keys from the **Azimuth** PKI. No central server is involved.

### Web Integration

Urbit's HTTP server (**Eyre**) exposes a channel system that web apps consume via Server-Sent Events. The official TypeScript client is `@urbit/http-api`:

```ts
import Urbit from "@urbit/http-api";

const api = await Urbit.authenticate({
  ship: "firbyr-napbes",
  url: "http://localhost:8080",
  code: "lidlut-tabwed-pillex-ridrup",
});

// One-off command
await api.poke({ app: "alex", mark: "alex-action", json: { ... } });

// Real-time subscription
api.subscribe({ app: "alex", path: "/updates", event: (data) => { ... } });

// Read-only query
const state = await api.scry({ app: "alex", path: "/state" });
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Alex Web App (Next.js)                                 │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐   ┌───────────────┐  │
│  │ Library UI  │  │ Social Feed  │   │ Friend Search │  │
│  └──────┬──────┘  └──────┬───────┘   └───────┬───────┘  │
│         │                │                   │          │
│  ┌──────┴────────────────┴───────────────────┴───────┐  │
│  │              Next.js API Routes                   │  │
│  │  /api/books, /api/collections (existing)          │  │
│  │  /api/urbit/* (new - proxy to local ship)         │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                               │
├─────────────────────────┼───────────────────────────────┤
│                         │ Eyre HTTP / @urbit/http-api   │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Urbit Ship (~firbyr-napbes)                     │   │
│  │                                                  │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  %alex-social  (Gall Agent)                │  │   │
│  │  │                                            │  │   │
│  │  │  State:                                    │  │   │
│  │  │  - friends: (set @p)                       │  │   │
│  │  │  - profile: {display-name, bio, avatar}    │  │   │
│  │  │  - activity: (list activity-event)         │  │   │
│  │  │  - server-url: (unit @t)                   │  │   │
│  │  │                                            │  │   │
│  │  │  Pokes (actions):                          │  │   │
│  │  │  - %add-friend ~ship                       │  │   │
│  │  │  - %remove-friend ~ship                    │  │   │
│  │  │  - %accept-friend ~ship                    │  │   │
│  │  │  - %share-activity activity-event          │  │   │
│  │  │  - %update-profile profile                 │  │   │
│  │  │  - %set-server-url @t                      │  │   │
│  │  │                                            │  │   │
│  │  │  Subscriptions (paths):                    │  │   │
│  │  │  - /friends       (friend list changes)    │  │   │
│  │  │  - /activity      (reading activity feed)  │  │   │
│  │  │  - /profile       (profile updates)        │  │   │
│  │  │  - /activity/~ship (single friend's feed)  │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  │                                                  │   │
│  │         ◄──── Ames (encrypted P2P) ────►         │   │
│  │              to/from friends' ships              │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ SQLite (existing)              Library folder (existing)|
│ users, books, readingProgress  /library/*.pdf, *.epub   │
└─────────────────────────────────────────────────────────┘
```

The key architectural decision: **the Urbit ship runs alongside the Alex server, not instead of it.** Alex keeps its existing SQLite database, file watcher, and API routes. The Urbit ship handles only identity, friend relationships, and activity sharing. The Next.js app talks to both.

---

## Phase 1: Urbit Identity as Login

**Goal**: Let users authenticate to any Alex server using their Urbit ship, replacing or supplementing email/password auth.

### What Changes

**New NextAuth provider: "Urbit"**

Instead of (or in addition to) email/password, a user can log in by proving they control a ship. The flow:

1. User enters their ship name (`~firbyr-napbes`) and the URL of their running ship
2. Alex's backend calls the ship's Eyre auth endpoint with the user's web login code
3. On success, Alex creates or looks up a local user record linked to that `@p`
4. A JWT session is issued as usual

**Schema addition:**

```
users table:
  + urbit_ship  TEXT UNIQUE  -- e.g. "~firbyr-napbes"
  + urbit_url   TEXT         -- e.g. "http://localhost:8080"
```

**What stays the same:**

- Reading progress, collections, and all existing features work identically
- Admin can still create password-only accounts for users without ships
- The SQLite database remains the source of truth for library data

### Deployment

The Alex Docker Compose file gains an Urbit container:

```yaml
services:
  alex:
    # ... existing Next.js app
    environment:
      - URBIT_URL=http://urbit:8080
  urbit:
    image: tloncorp/vere
    volumes:
      - urbit-pier:/urbit/pier
    ports:
      - "8080:8080"
```

The server admin boots a ship (planet or comet) that acts as the **server's identity**. Users connect their own ships to this server's ship.

---

## Phase 2: Friend Graph

**Goal**: Users can add each other as friends by ship name. Friendships are mutual (require acceptance) and stored on each user's ship.

### The `%alex-social` Gall Agent

A custom Hoon agent distributed as a desk (`%alex`) that each user installs on their ship. It manages:

- **Friend list**: a `(set @p)` of accepted friends
- **Pending requests**: inbound and outbound
- **Profile**: display name, bio, optional avatar URL

### Friend Request Flow

```
~alice                          ~bob
  │                               │
  ├── %poke %add-friend ~bob ──►  │
  │                               ├── on-poke: store pending request
  │                               │   notify via /friends subscription
  │                               │
  │  ◄── %poke %accept-friend ────┤
  │     ~alice                    │
  ├── on-poke: add ~bob           │
  │   to friends set              │
  │                               │
  │ ◄═══ subscribe /activity ════►│  (mutual subscription opens)
```

### Web UI

- **Friend search**: type a `@p`, see their profile (scried from their ship)
- **Friend requests**: accept/reject incoming requests
- **Friend list**: see all friends, their display names, online status

### Next.js Integration

New API routes that proxy to the local ship:

```
POST /api/urbit/friends/add      → poke %alex-social %add-friend
POST /api/urbit/friends/accept   → poke %alex-social %accept-friend
POST /api/urbit/friends/remove   → poke %alex-social %remove-friend
GET  /api/urbit/friends          → scry %alex-social /friends
GET  /api/urbit/profile/~ship    → scry remote ship's %alex-social /profile
```

---

## Phase 3: Activity Sharing

**Goal**: Friends can see what each other are reading, finishing, and adding to collections.

### Activity Events

When a user performs certain actions in Alex, the Next.js backend publishes an activity event to their ship:

```typescript
// In the reading progress API handler:
await urbitApi.poke({
  app: "alex-social",
  mark: "alex-action",
  json: {
    "share-activity": {
      type: "started-reading",
      book: { title: "Dune", author: "Frank Herbert" },
      timestamp: Date.now(),
    },
  },
});
```

Activity types:

- `started-reading` --- user began a new book
- `finished-reading` --- user completed a book
- `added-to-collection` --- user added a book to a named collection
- `added-to-library` --- a new book appeared in the user's library

The `%alex-social` agent stores recent activity and pushes it to all friends subscribed on `/activity`.

### Privacy Controls

Not everything should be shared by default:

- **Per-book opt-out**: mark specific books as private (not shared in activity)
- **Activity type toggles**: e.g., share completions but not started-reading
- **Collection visibility**: collections can be public (shared) or private

These preferences are stored locally in SQLite (not on the ship), and the Next.js backend checks them before publishing activity to the ship.

### Web UI: Social Feed

A new page (`/social` or `/feed`) that aggregates activity from all friends:

```
~alice finished reading "Dune" by Frank Herbert          2 hours ago
~bob   started reading "Neuromancer" by William Gibson   5 hours ago
~carol added "Snow Crash" to collection "Cyberpunk"      1 day ago
```

The feed is populated by subscribing to `/activity` on the local ship, which aggregates activity from all friends.

---

## Phase 4: Cross-Server Book Discovery

**Goal**: When a friend shares activity about a book, you can see it even if it's not in your library. If their server is reachable, you can browse their public shelves.

### Server URL Exchange

Each user's `%alex-social` agent stores their Alex server's public URL. When you add a friend, their server URL is part of the profile exchange.

### Public Shelves API

A new set of **unauthenticated** API routes that expose public collection data:

```
GET /api/public/profile          → server name, description
GET /api/public/collections      → list of public collections
GET /api/public/collections/:id  → books in a public collection
```

These routes return only metadata (title, author, cover thumbnail) --- never file downloads. Access to actual files still requires a local authenticated account.

### "Want to Read" / Wishlists

When you see a book on a friend's shelf that you don't have:

- You can add it to a local **"Want to Read"** list (stored in SQLite)
- If the book later appears in your library (via the file watcher), it auto-matches

This avoids any copyright concerns --- no files are transferred between servers, only metadata.

---

## Phase 5: Reading Groups

**Goal**: Groups of friends can read a book together, with shared progress tracking and discussion.

### Leveraging Urbit Groups

Urbit already has a `%groups` agent with channels (chat, notebooks). Rather than rebuilding group infrastructure, `%alex-social` can create **Urbit groups** with an Alex-specific channel type.

A reading group would be:

- An Urbit group with invited members
- A custom `%alex-reading-group` channel within that group
- State: the book being read, each member's progress, discussion messages

### Reading Group Features

- **Shared progress bar**: see where everyone is in the book
- **Chapter discussions**: threaded comments anchored to chapter/page numbers
- **Pace suggestions**: "Let's read through chapter 5 by Friday"
- **Spoiler protection**: discussion for chapters ahead of your progress is hidden

---

## Technical Considerations

### Hoon Development

Phases 2--5 require writing a Gall agent in **Hoon**, Urbit's native language. This is the largest barrier to entry. The `%alex-social` agent needs:

- State management (friends, activity, profiles)
- Poke handlers for all action types
- Subscription management with proper permission checks
- Upgrade paths for state schema changes

Resources:

- [App School](https://docs.urbit.org/courses/app-school/intro) --- official Gall agent tutorial
- [App School Full Stack](https://docs.urbit.org/courses/app-school-full-stack) --- Gall + Eyre + web frontend
- [Tlon Apps](https://github.com/tloncorp/tlon-apps) --- reference implementation for groups/chat

### Comet Support

Not every user will have (or want) a planet. Comets are free and require no blockchain interaction, but they have drawbacks:

- Long, unmemorable names (128-bit)
- Less trusted by the network (some groups block comets)
- Cannot spawn moons

For Alex, comets should be supported as a "guest" tier --- full social features, but friends may see a warning that the identity is unverified/disposable.

### Ship Hosting

Running an Urbit ship requires a persistent process. Options:

1. **Bundled with Alex** (recommended for self-hosters): the Docker Compose file includes a Vere (Urbit runtime) container alongside the Next.js container. The admin boots a ship once, and it runs alongside Alex.

2. **Hosted Urbit** (recommended for casual users): services like Tlon offer managed ship hosting. Users point Alex at their hosted ship's URL.

3. **No ship** (graceful degradation): Alex works fully without Urbit. Social features are simply unavailable. The UI hides social elements for users without a linked ship.

### Data Sovereignty

A design principle: **the Urbit ship stores only social graph data** (friends, activity, profiles). It never stores book files, reading progress, or collection contents. Those stay in SQLite on the Alex server.

This means:

- If the ship goes down, the library still works perfectly
- If the Alex server goes down, your Urbit identity and friend list persist
- Book files never touch the Urbit network

### CORS and Security

For the Next.js backend to talk to the Urbit ship:

- If co-located (same Docker network): use internal hostname, no CORS needed
- If remote: the ship must approve Alex's origin via `|cors-approve`
- The ship's web login code should be stored as an environment variable, not exposed to the browser
- All Urbit API calls should go through Next.js API routes (server-side), never directly from the browser

---

## Migration Path

The phased approach means each phase is independently useful:

| Phase             | Value Without Later Phases                                  |
| ----------------- | ----------------------------------------------------------- |
| 1. Identity       | Decentralized login; your `@p` is your username everywhere  |
| 2. Friends        | See who else uses Alex; portable friend list                |
| 3. Activity       | Know what friends are reading without a centralized service |
| 4. Discovery      | Find books through friends instead of algorithms            |
| 5. Reading Groups | Book clubs with built-in progress tracking                  |

Each phase can ship independently. A user with Phase 1 gets value immediately (a global identity), even if no friends are on the network yet.

---

## Open Questions

- **Urbit ecosystem health**: Urbit's userbase is small. Is the identity layer worth the Hoon development cost, or should we consider a lighter-weight P2P identity system (e.g., DID/AT Protocol) as a backup?
- **Ship performance**: How does Urbit handle frequent activity events (every page turn)? We likely need to batch/debounce and only share meaningful milestones.
- **Discovery without centralization**: How do users find other Alex users on Urbit without a directory? Options: a well-known group, a simple "Alex users" flag in ship metadata, or integration with Urbit's existing app discovery.
- **Planet acquisition UX**: Getting a planet still has friction (even with free L2 rollers). How much onboarding help should Alex provide? Should it offer to boot a comet as a one-click fallback?
