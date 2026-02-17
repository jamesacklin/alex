# Peer-to-Peer Server Discovery and Book Sharing with Hypercore

## The Idea

Alex is currently a single-server application. Each instance is an island — there is no mechanism for two Alex servers to discover each other, share metadata, or transfer books. If Alice and Bob each run Alex, they have no way to browse each other's libraries or send each other books without manual file transfer.

The goal is to give Alex servers a **peer-to-peer networking layer** so that:

1. Servers can **discover** each other without a central registry
2. Users can **browse** a peer's public library metadata
3. Users can **request and receive** book files directly, server-to-server
4. All communication is **encrypted, authenticated, and NAT-traversing** with no port forwarding required

Hypercore (and its networking stack Hyperswarm / HyperDHT) is a strong fit because:

1. **No infrastructure required** — DHT-based discovery, no relay server
2. **NAT traversal built in** — HyperDHT handles hole-punching automatically
3. **Authenticated by default** — the Noise protocol handshake verifies both endpoints
4. **Efficient replication** — Hypercore is an append-only log optimized for partial sync
5. **TypeScript-native** — the entire stack runs in Node.js

---

## Background: How Hypercore Works (Abridged)

### Identity: Keypairs and z32

Each Alex server generates an **ed25519 keypair** on first run. The 32-byte public key is the server's permanent identity. For human sharing, it is encoded as a **z32 string** (52 lowercase alphanumeric characters):

```
yry5g7ya7reowym3c176fh7xh4mpe9kbzrmsidwntfypo5s3ise1buhfb1y8o
```

This is the equivalent of an IP address + authentication certificate in one. Anyone who knows your z32 key can connect to you, and the connection is authenticated — you can't be impersonated.

### HyperDHT: Finding Peers

HyperDHT is a Kademlia-based distributed hash table. When an Alex server starts:

1. It **announces** its public key on the DHT ("I am online and reachable")
2. Other servers can **look up** a public key on the DHT to find connection details
3. HyperDHT handles **NAT traversal** via UDP hole-punching — no port forwarding, no relay

```ts
import DHT from "hyperdht";

const dht = new DHT();
const keyPair = DHT.keyPair(); // ed25519

// Server: announce presence
const server = dht.createServer((socket) => {
  // Incoming authenticated connection
  // socket.remotePublicKey identifies the peer
});
await server.listen(keyPair);

// Client: connect to a known peer
const socket = dht.connect(peerPublicKey);
```

The DHT itself is a global, permissionless network of nodes. Alex servers participate in the DHT to discover each other but don't depend on any central infrastructure.

### Hyperswarm: Higher-Level Discovery

Hyperswarm wraps HyperDHT with a "topic" abstraction. Servers can join a shared topic (a 32-byte hash) to discover each other without exchanging keys in advance:

```ts
import Hyperswarm from "hyperswarm";

const swarm = new Hyperswarm();

// Join a topic — all Alex servers could join the same topic
const topic = Buffer.alloc(32).fill("alex-reader");
const discovery = swarm.join(topic, { server: true, client: true });
await discovery.flushed();

swarm.on("connection", (socket, info) => {
  // Authenticated peer connected
  // info.publicKey is their identity
});
```

### Hypercore: Append-Only Logs

Hypercore is a signed, append-only log. Each entry is numbered, content-addressed, and verifiable. It is the data structure that peers replicate:

```ts
import Hypercore from "hypercore";

const core = new Hypercore("./storage/library-feed");

// Append library metadata
await core.append(
  JSON.stringify({
    type: "book",
    title: "Dune",
    author: "Frank Herbert",
    isbn: "9780441013593",
    format: "epub",
    sizeBytes: 1245000,
  }),
);

// Remote peers can replicate this core and read any entry
const entry = await core.get(0);
```

Replication is incremental — a peer only downloads entries it doesn't already have. The Hypercore's public key is its address; knowing the key lets you replicate the feed from any connected peer that has it.

### Noise Protocol: Encrypted Connections

Every HyperDHT connection uses the **Noise protocol** (the same framework used by WireGuard and Signal). The handshake:

1. Authenticates both peers via their ed25519 public keys
2. Establishes a forward-secret encrypted channel
3. Happens automatically — no TLS certificates, no CA, no configuration

A compromised DHT node cannot eavesdrop on or tamper with connections. The DHT is only used for discovery; all data flows through direct encrypted tunnels.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Alex Server A                                            │
│                                                          │
│  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │ Next.js App  │  │ P2P Module                       │  │
│  │              │  │                                  │  │
│  │ /api/peers   │──│ HyperDHT server (listening)      │  │
│  │ /api/browse  │  │ Hypercore (library metadata feed) │  │
│  │ /api/request │  │ Hyperdrive (file transfer)       │  │
│  │              │  │                                  │  │
│  └──────────────┘  └──────────┬───────────────────────┘  │
│                               │                          │
└───────────────────────────────┼──────────────────────────┘
                                │ encrypted P2P
                    ┌───────────┴───────────┐
                    │     HyperDHT          │
                    │  (distributed hash    │
                    │   table — global,     │
                    │   no central server)  │
                    └───────────┬───────────┘
                                │ encrypted P2P
┌───────────────────────────────┼──────────────────────────┐
│  Alex Server B                │                          │
│                               │                          │
│  ┌──────────────┐  ┌─────────┴────────────────────────┐  │
│  │ Next.js App  │  │ P2P Module                       │  │
│  │              │  │                                  │  │
│  │ /api/peers   │──│ HyperDHT server (listening)      │  │
│  │ /api/browse  │  │ Hypercore (library metadata feed) │  │
│  │ /api/request │  │ Hyperdrive (file transfer)       │  │
│  │              │  │                                  │  │
│  └──────────────┘  └──────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Each Alex server maintains:

1. **A keypair** — its P2P identity (generated once, stored in the data directory)
2. **A Hypercore feed** — an append-only log of public library metadata (titles, authors, ISBNs, formats, sizes — never file content)
3. **A HyperDHT server** — listens for incoming peer connections
4. **A peer list** — z32 keys of known peers, stored in SQLite

When Server A adds Server B as a peer:

1. A connects to B via HyperDHT (using B's z32 public key)
2. The Noise handshake authenticates both servers
3. A replicates B's library metadata Hypercore
4. A can now display B's book catalog in its UI
5. If A's user requests a file, A opens a Hyperdrive stream to transfer it

---

## Data Model

### Library Metadata Feed (Hypercore)

Each server publishes a single Hypercore feed containing its public library catalog. Entries are JSON objects:

```json
{
  "type": "book-added",
  "id": "local-book-id-42",
  "title": "Dune",
  "author": "Frank Herbert",
  "isbn": "9780441013593",
  "format": "epub",
  "sizeBytes": 1245000,
  "addedAt": "2026-03-01T12:00:00Z"
}
```

```json
{
  "type": "book-removed",
  "id": "local-book-id-42",
  "removedAt": "2026-03-15T10:00:00Z"
}
```

The feed is append-only, so removals are recorded as new entries. Peers reconstruct the current catalog by replaying the log.

### Peer List (SQLite)

```sql
CREATE TABLE peers (
  public_key   TEXT PRIMARY KEY,  -- z32-encoded, 52 chars
  nickname     TEXT,              -- optional human-readable label
  added_at     TEXT NOT NULL,
  last_seen_at TEXT,
  is_online    INTEGER DEFAULT 0
);
```

### Server Identity (filesystem)

```
data/
  p2p/
    keypair.json        -- { publicKey, secretKey } (ed25519, hex-encoded)
    library-feed/       -- Hypercore storage for the local library metadata feed
    peer-feeds/         -- cached Hypercore storage for each peer's metadata feed
```

---

## Peer Management

### Adding a Peer

A user adds a peer by entering their z32 public key (or, with the [centralized username discovery service](./centralized-username-discovery.md), a `@username`):

1. The z32 string is decoded to a 32-byte public key
2. The key is stored in the `peers` table
3. Alex initiates a HyperDHT connection
4. On successful handshake, the peer's library metadata Hypercore is replicated
5. The peer's catalog appears in the UI under a "Peers" section

### Mutual vs. One-Way

Peer relationships are **mutual by design**. When A connects to B:

1. A sends its own public key as part of the Noise handshake
2. B can accept or reject the connection (allowlist model)
3. If accepted, both sides replicate each other's metadata feeds

Servers maintain an allowlist of accepted peer keys. Unknown connections are rejected by default. The admin explicitly approves new peers.

### Peer Discovery via Swarm Topic

For open/social Alex instances, an optional **swarm topic** mode lets servers discover each other without exchanging keys in advance:

1. Server joins the `alex-reader` Hyperswarm topic
2. Other servers on the same topic appear automatically
3. Admin can browse discovered servers and choose to add them as peers

This is opt-in. Private instances never join the public topic.

---

## Book Transfer Protocol

When a user wants a book from a peer's library:

### Request Flow

1. User browses peer's catalog (replicated via Hypercore) in the Alex UI
2. User clicks "Request" on a book
3. Alex opens a **Hyperdrive** stream to the peer
4. The peer's server checks its transfer policy (auto-accept, manual approval, or deny)
5. If approved, the file streams directly over the encrypted P2P connection
6. Alex saves the file locally and adds it to the local library

### Transfer Policies

Each server configures its sharing policy:

| Policy           | Behavior                                               |
| ---------------- | ------------------------------------------------------ |
| `auto-accept`    | Any approved peer can download any book automatically  |
| `manual-approve` | Owner gets a notification and must approve each request |
| `metadata-only`  | Peers can see the catalog but cannot request files      |

### Hyperdrive for File Transfer

Hyperdrive is a filesystem abstraction built on Hypercore. It handles:

- Chunked streaming (no need to load the entire file into memory)
- Integrity verification (each chunk is content-addressed)
- Resume on reconnection (if the connection drops, transfer picks up where it left off)

```ts
import Hyperdrive from "hyperdrive";

// Sender: serve a file
const drive = new Hyperdrive(corestore);
await drive.put(`/books/${bookId}.epub`, fileBuffer);

// Receiver: read a file
const stream = drive.createReadStream(`/books/${bookId}.epub`);
stream.pipe(fs.createWriteStream(localPath));
```

---

## Next.js Integration

### API Routes

```
GET    /api/p2p/identity          → { publicKey: "yry5g7ya...", z32: "..." }
GET    /api/p2p/peers             → list all peers with online status
POST   /api/p2p/peers             → add a peer by z32 key or @username
DELETE /api/p2p/peers/:key        → remove a peer
GET    /api/p2p/peers/:key/books  → browse a peer's library catalog
POST   /api/p2p/transfer          → request a book from a peer
GET    /api/p2p/transfers         → list pending/active/completed transfers
POST   /api/p2p/transfers/:id/approve  → approve an incoming transfer request
```

### P2P Module Lifecycle

The P2P module initializes when the Next.js server starts:

1. Load or generate keypair from `data/p2p/keypair.json`
2. Initialize Hypercore for the local library metadata feed
3. Start HyperDHT server (listening for incoming connections)
4. Connect to known peers from the `peers` table
5. Begin replicating metadata feeds

On shutdown, the module gracefully disconnects from all peers and flushes pending writes.

### UI Components

- **Peer Management page** (`/settings/peers`): add/remove peers, view online status, copy own z32 key
- **Peer Library browser** (`/peers/:key`): browse a connected peer's catalog
- **Transfer queue** (`/transfers`): see pending requests, approve incoming, track progress
- **"Add Peer" modal**: input field for z32 key or `@username`, with QR code scanning for mobile

---

## Security Model

### Authentication

Every connection is authenticated by the Noise protocol handshake. The z32 public key is both the address and the identity certificate. There is no separate authentication step — if the handshake succeeds, both peers are verified.

### Authorization

The allowlist model ensures only approved peers can connect. Unapproved connections are dropped at the handshake level.

### Encryption

All data in transit is encrypted with forward-secret keys derived from the Noise handshake. Even if a server's long-term key is compromised in the future, past traffic cannot be decrypted.

### Trust Model

Trust is **explicit and bilateral**. You only share data with peers you've manually approved. There is no global reputation system, no transitive trust, no "friend of a friend" access. This matches the self-hosted ethos of Alex — you control exactly who sees your library.

### File Integrity

Hypercore entries are content-addressed (each entry's hash is part of a Merkle tree signed by the author's key). A malicious peer cannot tamper with their catalog retroactively — if an entry is modified, the Merkle proof fails and the replicating peer detects the corruption.

---

## Technical Considerations

### Dependencies

```
hypercore         — append-only log
hyperswarm        — DHT-based peer discovery
hyperdht          — NAT-traversing DHT
hyperdrive        — filesystem on Hypercore (for file transfer)
corestore         — manage multiple Hypercores
b4a               — buffer utilities
z32               — z-base-32 encoding for public keys
```

All are JavaScript/TypeScript packages. No native binaries, no sidecar processes.

### Resource Usage

- **Memory**: Hyperswarm + HyperDHT use ~50–100 MB for a few dozen connections
- **Disk**: Hypercore storage is proportional to the catalog size (small) plus cached peer feeds
- **Network**: DHT maintenance is minimal (~1 KB/s). File transfers use bandwidth proportional to file size
- **CPU**: Noise handshakes and Merkle verification are lightweight

### Offline Behavior

When a peer is offline, its last-known catalog remains cached locally. Users can browse the cached catalog and queue transfer requests. When the peer comes back online, queued requests are automatically fulfilled.

### Electron / Desktop

The P2P stack works identically in the Electron desktop app. The DHT client runs in the Node.js main process. No browser APIs are needed — Hyperswarm is a pure Node.js library.

---

## Phased Implementation

| Phase | Feature                     | Value                                                    |
| ----- | --------------------------- | -------------------------------------------------------- |
| 1     | Keypair generation + identity | Server has a z32 address; can be shared out-of-band     |
| 2     | Peer connections            | Two servers can connect and authenticate via HyperDHT    |
| 3     | Library metadata replication | Browse a peer's catalog in the Alex UI                  |
| 4     | File transfer               | Request and receive books from peers                     |
| 5     | Swarm topic discovery       | Optional open discovery without pre-shared keys          |

Each phase is independently useful. Phase 1–2 alone give you authenticated, encrypted server-to-server connections that future features can build on.

---

## Open Questions

- **Multi-user servers**: If an Alex server has multiple local users, should each user have their own keypair (so peers are per-user), or should the server have one keypair (so peering is server-wide)? Server-wide is simpler; per-user is more private.
- **Catalog granularity**: Should the metadata feed include every book, or should users curate a "public shelf" subset? Publishing the full catalog is simpler; a curated subset offers more control.
- **Bandwidth limits**: Should there be configurable rate limits on file transfers to prevent a popular server from being overwhelmed?
- **Feed compaction**: The append-only metadata feed grows forever. Should we periodically compact it (snapshot the current catalog and start a new feed)?
- **Discovery service integration**: The [centralized username discovery service](./centralized-username-discovery.md) is an optional convenience layer. Should Alex prompt users to register a username on first setup, or keep it entirely opt-in?
