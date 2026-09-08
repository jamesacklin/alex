# Relay Worker (`alex-relay`)

## Overview

The relay runs on Cloudflare Workers. A `Tunnel` Durable Object is created for each public subdomain; that object owns the desktop client's WebSocket and multiplexes browser requests over it. There is no VM, listening port, reverse proxy, or TLS process to operate.

Cloudflare's WebSocket Hibernation API keeps idle tunnel connections open while allowing their Durable Objects to sleep.

## Project Layout

```
alex-relay/
  package.json
  wrangler.jsonc       — Worker routes, variables, Durable Object binding/migration
  src/
    index.ts           — Worker router and Tunnel Durable Object
    protocol.ts        — bincode-compatible frame codec
  test/
    protocol.test.ts   — wire-format tests
    relay.test.ts      — local workerd integration tests
```

## Protocol

Version 2. Bincode 1's fixed-integer, little-endian encoding over binary
WebSocket messages. Frame variants are identified by their declaration index,
so new variants are appended and existing ones never move:

```rust
enum Frame {
    Register { subdomain: String },                 // v1 only; rejected by a v2 relay
    RegisterAck { success: bool, message: String },
    HttpRequest { request_id: u64, method: String, uri: String, headers: Vec<(String, String)>, body: Vec<u8> },
    HttpResponse { request_id: u64, status: u16, headers: Vec<(String, String)> },
    ResponseChunk { request_id: u64, data: Vec<u8> },
    ResponseEnd { request_id: u64 },
    Ping,
    Pong,
    Challenge { protocol_version: u16, nonce: Vec<u8>, claimed: bool },
    Claim { protocol_version: u16, subdomain: String, secret: Vec<u8> },
    Prove { protocol_version: u16, subdomain: String, proof: Vec<u8> },
    Rotate { protocol_version: u16, subdomain: String, proof: Vec<u8>, new_secret: Vec<u8> },
    Cancel { request_id: u64 },
}
```

### Name ownership

A public hostname has a persistent owner. The Durable Object stores a 32-byte
secret for its name in `storage`, and every connection must prove knowledge of
it:

1. The relay accepts the socket and immediately sends
   `Challenge { nonce, claimed }` — a fresh 32-byte random nonce, and whether
   an owner is already on record.
2. If the name is unclaimed, the client sends `Claim { subdomain, secret }`
   once. If it is claimed, the client sends
   `Prove { subdomain, proof }` where
   `proof = HMAC-SHA256(secret, nonce ‖ subdomain)`.
3. `Rotate { subdomain, proof, new_secret }` proves ownership and replaces the
   stored secret in one step.

Because the nonce is per-connection, a captured proof cannot be replayed on a
later one; because the subdomain is part of the signed message, a proof for
one name cannot be presented for another. The secret itself crosses the wire
only during the initial claim.

Version 1 registered a name by simply asserting it, and nothing about the name
was persisted — so once the owner disconnected, any client could register the
same public hostname and receive requests, and cookies, intended for that
owner. A v1 `Register` frame is now answered with an explanatory
`RegisterAck { success: false }` and the socket is closed.

A socket that has not registered within `REGISTRATION_DEADLINE_MS`
(15 seconds by default) is closed rather than left hibernating.

### Connection generations

Each accepted socket is tagged with a monotonic generation counter, and every
pending request records the generation it was issued under. A close or error
event from a replaced connection therefore cannot fail requests belonging to
the current one, and a new connection cannot answer a request issued to a
previous one.

### Routing

The Workers router must choose a Durable Object before it receives the first
WebSocket message. The client therefore connects to:

```
wss://relay.alexreader.app/_tunnel/ws?subdomain=gentle-morning-tide
```

The client adds this query parameter automatically from its `--subdomain`
argument. The Durable Object verifies that the registration frame's subdomain
matches it before acknowledging.

## Message Flow

1. The client opens the WebSocket URL with its subdomain query parameter.
2. The Worker routes the upgrade to the Durable Object named for that subdomain.
3. The object sends `Challenge`; the client answers `Claim`, `Prove` or
   `Rotate`; the object verifies it and returns `RegisterAck`.
4. A browser requests `https://gentle-morning-tide.alexreader.app/some/page`.
5. The Worker extracts the subdomain and forwards the request to the same object.
6. The object sends `HttpRequest` through the registered WebSocket.
7. The desktop forwards to `http://127.0.0.1:3210` and sends response headers and chunks.
8. The Durable Object streams those chunks to the browser.

Each object assigns `u64` request IDs and keeps a correlation entry for every
in-flight request. Multiple requests share the desktop WebSocket.

### HTTP semantics

- 204, 205 and 304, and any response to `HEAD`, are returned with a null
  body. Constructing them with a stream body is invalid and previously turned
  a valid 204 from the origin into a 502.
- The client forwards each body chunk as it arrives, splitting only above
  64 KiB. It does not accumulate a buffer first, so server-sent events and
  keepalives reach the browser promptly.
- `Cancel` runs in both directions. The relay sends it when the browser
  disconnects, so the desktop stops working on a response nobody will read;
  the client sends it when an upstream transfer fails after headers, so the
  browser sees a broken transfer rather than a truncated body presented as a
  complete one.

### Limits

| Limit | Value | Behaviour when exceeded |
| --- | --- | --- |
| Request body | 10 MiB | 413. Enforced *while reading*, so a chunked request with no `Content-Length` is not buffered whole first. |
| Pending requests per tunnel | 64 | 503 with `Retry-After: 1` |
| Response bytes queued per request | 8 MiB | The response is aborted and `Cancel` is sent |
| Response bytes queued across the tunnel | 32 MiB | As above |
| Response header / body chunk interval | `REQUEST_TIMEOUT_MS` (120s) | 504, or the body stream is aborted |
| Registration | `REGISTRATION_DEADLINE_MS` (15s) | Socket closed |

### Header handling at the trust boundary

The relay is the boundary between the public internet and a local app, so it
replaces rather than forwards anything that would let a caller impersonate
infrastructure:

- `x-forwarded-host` and `x-forwarded-proto` are set from the request's own
  hostname and to `https`; a caller-supplied value is dropped, because
  middleware builds redirects from them.
- `x-forwarded-for` is set from `cf-connecting-ip`, which only the edge can
  set. `forwarded`, `x-real-ip`, `x-forwarded-port` and
  `x-forwarded-server` are dropped.
- Every `x-alex-*` header is dropped, including the desktop capability token
  `x-alex-desktop-auth`.

The Rust client applies the same rules again on its side, so neither half
depends on the other having done it.

## Local Development

From the repository root:

```bash
pnpm install
pnpm typecheck:relay
pnpm test:relay
pnpm --filter @alex/relay dev
```

Tests run in Cloudflare's local `workerd` runtime through the Workers Vitest integration.

## Configuration

`wrangler.jsonc` defines:

- `BASE_DOMAIN`: the domain used to extract tunnel subdomains.
- `REQUEST_TIMEOUT_MS`: header/body timeout for tunneled requests.
- `TUNNELS`: the Durable Object namespace.
- `*.alexreader.app/*`: the wildcard Worker route.

If the production domain changes, update both the route and `BASE_DOMAIN`, then update `RELAY_URL` and `TUNNEL_DOMAIN` in `electron/main.ts`.
