# Relay Server (`alex-relay`)

## Overview

The relay is a lightweight Rust server that runs on a VPS behind Caddy. It accepts WebSocket connections from Alex desktop clients, registers their chosen subdomains, and proxies incoming HTTP requests to the correct client over the WebSocket.

## Crate Layout

```
alex-relay/
  Cargo.toml
  src/
    main.rs        — CLI entry point (clap)
    relay.rs       — RelayState, WebSocket acceptor, subdomain registration
    proxy.rs       — HTTP handler: subdomain lookup, request forwarding
    protocol.rs    — Frame enum (shared with watcher-rs tunnel)
```

## CLI

```
alex-relay --listen-addr 0.0.0.0:8080 --domain alexreader.app
```

| Flag | Default | Description |
|------|---------|-------------|
| `--listen-addr` | `0.0.0.0:8080` | Address to bind the HTTP server |
| `--domain` | `alexreader.app` | Base domain for subdomain extraction |

## Protocol

All frames are serialized with **bincode** and sent as binary WebSocket messages.

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

### Message Flow

1. Client connects to `wss://relay.alexreader.app/_tunnel/ws`
2. Client sends `Register { subdomain: "gentle-morning-tide" }`
3. Relay responds with `RegisterAck { success: true, message: "registered" }`
4. Browser hits `https://gentle-morning-tide.alexreader.app/some/page`
5. Caddy terminates TLS, proxies to relay `:8080`
6. Relay extracts subdomain from `Host` header, looks up client
7. Relay sends `HttpRequest { request_id: 1, method: "GET", uri: "/some/page", ... }`
8. Client forwards to `http://127.0.0.1:3210/some/page`, streams response back
9. Client sends `HttpResponse { ... }` then `ResponseChunk { ... }` (repeated) then `ResponseEnd { ... }`
10. Relay reconstructs HTTP response and sends it to the browser

### Request Multiplexing

Each HTTP request gets a monotonically increasing `request_id` (u64). Multiple in-flight requests share the same WebSocket. The relay holds a `DashMap<u64, oneshot::Sender<...>>` to correlate response frames back to the correct HTTP handler.

## State

```rust
struct RelayState {
    clients: DashMap<String, ClientHandle>,  // subdomain → client
    domain: String,
}

struct ClientHandle {
    tx: mpsc::Sender<Frame>,                // send frames to this client's WS writer
    pending: Arc<DashMap<u64, oneshot::Sender<ResponseCollector>>>,
    next_request_id: Arc<AtomicU64>,
}
```

## Deployment

Caddy runs in front of the relay to handle TLS termination with a wildcard certificate for `*.alexreader.app`, obtained via DNS-01 challenge with the Cloudflare plugin.

Example Caddyfile:

```
*.alexreader.app {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    reverse_proxy 127.0.0.1:8080
}
```

The Rust binary listens on plain HTTP only.
