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

The desktop protocol remains bincode 1's fixed-integer, little-endian encoding over binary WebSocket messages:

```rust
enum Frame {
    Register { subdomain: String },
    RegisterAck { success: bool, message: String },
    HttpRequest { request_id: u64, method: String, uri: String, headers: Vec<(String, String)>, body: Vec<u8> },
    HttpResponse { request_id: u64, status: u16, headers: Vec<(String, String)> },
    ResponseChunk { request_id: u64, data: Vec<u8> },
    ResponseEnd { request_id: u64 },
    Ping,
    Pong,
}
```

The Workers router must choose a Durable Object before it receives the first WebSocket message. The client therefore connects to:

```
wss://relay.alexreader.app/_tunnel/ws?subdomain=gentle-morning-tide
```

The client adds this query parameter automatically from its `--subdomain` argument, then sends the existing `Register` frame. The Durable Object verifies that the two values match before acknowledging registration.

## Message Flow

1. The client opens the WebSocket URL with its subdomain query parameter.
2. The Worker routes the upgrade to the Durable Object named for that subdomain.
3. The client sends `Register`; the object validates it and returns `RegisterAck`.
4. A browser requests `https://gentle-morning-tide.alexreader.app/some/page`.
5. The Worker extracts the subdomain and forwards the request to the same object.
6. The object sends `HttpRequest` through the registered WebSocket.
7. The desktop forwards to `http://127.0.0.1:3210` and sends response headers and chunks.
8. The Durable Object streams those chunks to the browser.

Each object assigns `u64` request IDs and keeps a correlation entry for every in-flight request. Multiple requests share the desktop WebSocket. Request bodies are limited to 10 MiB; response headers and each subsequent body chunk must arrive within `REQUEST_TIMEOUT_MS` (120 seconds by default).

## Local Development

From the repository root:

```bash
pnpm install
pnpm --filter @alex/relay typecheck
pnpm --filter @alex/relay test
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
