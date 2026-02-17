# Centralized Username Discovery Service

## The Idea

The [P2P Hypercore sharing layer](./p2p-hypercore-sharing.md) identifies Alex servers by their z32-encoded public keys — 52-character strings like:

```
yry5g7ya7reowym3c176fh7xh4mpe9kbzrmsidwntfypo5s3ise1buhfb1y8o
```

These are cryptographically secure and self-authenticating, but not human-friendly. The goal is to let users register a **human-readable username** (`@jamesacklin`) that maps to their z32 key, so peer discovery can happen by name instead of by opaque string.

This is a **phonebook** — a simple, centralized key-value mapping service. All actual data transfer remains peer-to-peer via Hyperswarm. The discovery service is only consulted at the moment of first contact.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   Discovery Service                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  names table                                           │  │
│  │                                                        │  │
│  │  username     TEXT PRIMARY KEY                         │  │
│  │  public_key   TEXT (z32-encoded, 52 chars)             │  │
│  │  created_at   TIMESTAMP                                │  │
│  │  updated_at   TIMESTAMP                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Three endpoints:                                            │
│                                                              │
│  PUT    /names/:username   — register or update (signed)     │
│  GET    /names/:username   — resolve (public, no auth)       │
│  DELETE /names/:username   — deregister (signed)             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

That's the entire data model. One table, three endpoints, a phonebook.

---

## Registration with Proof of Ownership

The service must verify that the person claiming `@jamesacklin` actually controls the corresponding private key. Otherwise anyone could register a name pointing to someone else's key.

### Registration Request

```
PUT /names/jamesacklin

{
  "publicKey": "yry5g7ya7reowym3c176fh7xh4mpe9kbzrmsidwntfypo5s3ise1buhfb1y8o",
  "timestamp": 1739836800,
  "signature": "<ed25519 sig of 'jamesacklin:yry5g7ya...:1739836800'>"
}
```

### Server Verification

1. **Verify signature**: the ed25519 signature must be valid for the message `username:publicKey:timestamp` using the provided public key
2. **Check timestamp**: must be within a reasonable window (e.g., 5 minutes) to prevent replay attacks
3. **Check availability**: if the username is unclaimed, store the mapping; if already claimed, reject (unless the signature matches the existing key on file — for updates)

### Resolution

No authentication needed. Anyone can look up a username:

```
GET /names/jamesacklin

→ {
    "publicKey": "yry5g7ya7reowym3c176fh7xh4mpe9kbzrmsidwntfypo5s3ise1buhfb1y8o"
  }
```

### Deregistration

Signed with the key currently on file:

```
DELETE /names/jamesacklin

{
  "timestamp": 1739836800,
  "signature": "<ed25519 sig of 'delete:jamesacklin:1739836800'>"
}
```

---

## Client Flow

When Bob types `@jamesacklin` in the "Add Peer" field in Alex:

```
  Bob's Alex                Discovery Service              Jamesacklin's Alex
  ─────────                ─────────────────              ──────────────────
      │                          │                              │
      │  GET /names/jamesacklin  │                              │
      │─────────────────────────►│                              │
      │                          │                              │
      │  { publicKey: "yry5..." }│                              │
      │◄─────────────────────────│                              │
      │                          │                              │
      │  (service is done — never contacted again)              │
      │                                                         │
      │  dht.connect(publicKey)                                 │
      │────────────────────────────────────────────────────────►│
      │                                                         │
      │  Noise handshake ✓  (authenticated, encrypted)          │
      │◄───────────────────────────────────────────────────────►│
      │                                                         │
      │  Hypercore replication (library metadata)               │
      │◄───────────────────────────────────────────────────────►│
```

**Step 4 is critical**: after first resolution, Bob's client caches the `jamesacklin → yry5g7ya...` mapping locally in SQLite. If the discovery service goes down, Bob can still connect to every peer he has resolved before. The service is a convenience for first contact, not a dependency for ongoing use.

---

## Key Rotation

If a user generates a new keypair, they need to update their registration. The update is signed with the **old** key to prove they own the current registration:

```
PUT /names/jamesacklin

{
  "publicKey": "<new z32 key>",
  "previousKey": "<old z32 key>",
  "timestamp": 1739836800,
  "signature": "<ed25519 sig using OLD private key>"
}
```

The server verifies the signature against the key currently on file (`previousKey`). If valid, the mapping is updated to the new key.

---

## Implementation Options

The service is small enough to deploy anywhere:

| Option                          | Pros                                    | Cons                           |
| ------------------------------- | --------------------------------------- | ------------------------------ |
| **Cloudflare Worker + D1**      | Edge-deployed, free tier, SQLite-native | Vendor lock-in                 |
| **Fly.io + SQLite**             | Simple, global distribution             | Needs persistent volume        |
| **Standalone Node.js + SQLite** | Self-hostable, no vendor dependency     | Needs a server                 |
| **Next.js API route**           | Lives inside Alex itself                | Ties discovery to one instance |

The recommended approach is a **standalone service** (Cloudflare Worker + D1 or Fly.io) so that:

- It's always available, even when individual Alex instances are offline
- It's a shared resource, not coupled to any one Alex server
- It's lightweight — a few requests per minute at most

---

## Username Validation

Usernames should follow simple rules:

- **Allowed characters**: lowercase alphanumeric and hyphens (`[a-z0-9-]`)
- **Length**: 3–32 characters
- **No leading/trailing hyphens**: `jamesacklin` is valid, `-james-` is not
- **Reserved names**: block common reserved words (`admin`, `api`, `www`, `null`, `undefined`, etc.)

---

## Rate Limiting

To prevent namespace squatting:

- **Registration**: max 5 registrations per IP per hour
- **Resolution**: generous limits (100 requests/minute per IP) — this is the hot path
- **Failed attempts**: exponential backoff on signature verification failures

---

## What the Service Is Not

- **Not a relay.** No book data, metadata, or Hypercore traffic flows through it. It only maps names to keys.
- **Not required.** The P2P system works perfectly with raw z32 keys. The discovery service is purely a convenience layer. If it's down, users can still share keys out-of-band (QR code, copy-paste, etc.).
- **Not a session or auth provider.** Alex instances authenticate each other via the Noise protocol handshake on the Hyperswarm connection. The discovery service cannot man-in-the-middle that, even if compromised.
- **Not a single point of failure.** If it goes down, existing peer relationships (cached locally) keep working. Only _new_ peer discovery by username is affected.

### Worst-Case Compromise

The worst a compromised discovery service can do is return the wrong key for a username. The connecting client would then establish an encrypted session with the wrong peer — but they'd notice immediately (wrong library, wrong content). Further mitigation:

- **Fingerprint display**: show the peer's z32 fingerprint in the UI so users can verify out-of-band on first connection (SSH-style TOFU — Trust On First Use)
- **Local cache**: once resolved, the mapping is cached locally and the service is never consulted again for that peer
- **Pinning**: after first successful connection, Alex could pin the key and warn if the discovery service returns a different key in the future

---

## Integration with Alex

### Settings UI

The peer management page (`/settings/peers`) gets a username registration section:

1. **Register username**: enter a desired username, Alex signs the registration request with the server's private key, sends it to the discovery service
2. **Current username**: displays the registered username (if any) alongside the z32 key
3. **Share link**: "Add me as a peer: `@jamesacklin`" — copyable text for sharing

### Add Peer Flow

The "Add Peer" input field accepts both formats:

- `@jamesacklin` → resolves via discovery service, then connects via HyperDHT
- `yry5g7ya7reowym3c176fh7xh4mpe9kbzrmsidwntfypo5s3ise1buhfb1y8o` → connects directly via HyperDHT

The UI auto-detects which format was entered (starts with `@` vs. a 52-char z32 string).

---

## Open Questions

- **Uniqueness disputes**: What happens if two people want the same username? First-come-first-served is the simplest model, but should there be a dispute/reclaim process?
- **Expiry**: Should registrations expire if not renewed periodically (e.g., annually)? This would free up abandoned names but adds complexity.
- **Multiple services**: Should the protocol support querying multiple discovery services (like DNS resolvers)? This would reduce centralization but adds client complexity.
- **Federation**: Could the discovery service itself be federated — multiple operators running compatible instances with shared state? This is likely over-engineering for the initial version.
- **Verified domains**: Should there be a way to link a username to a domain (e.g., `@jamesacklin` verifies via a DNS TXT record)? This would add legitimacy but mirrors what AT Protocol already does with handles.
