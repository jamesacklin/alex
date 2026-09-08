# Client Tunnel (`watcher-rs` tunnel module)

## Overview

The tunnel client runs as a subcommand of `watcher-rs`. It opens an outbound WebSocket connection to the relay server, proves ownership of its subdomain, and forwards incoming HTTP requests to the local Next.js server at `127.0.0.1:3210`.

## Module Layout

```
watcher-rs/src/tunnel/
  mod.rs          — public run(config, shutdown) entry point
  client.rs       — WebSocket connection, reconnect with exponential backoff
  proxy.rs        — Forward HttpRequest frames to local server, stream response back
  protocol.rs     — Frame enum (same as relay's), PROTOCOL_VERSION
  auth.rs         — HMAC-SHA256 ownership proofs (built on the existing sha2 dep)
  wordlist.rs     — ~500 adjectives + ~500 nouns, generate_subdomain() -> String
```

## CLI Subcommand

```
watcher-rs tunnel --subdomain gentle-morning-tide \
                  --relay-url wss://relay.alexreader.app/_tunnel/ws \
                  --local-addr 127.0.0.1:3210
```

The client appends `?subdomain=gentle-morning-tide` to the upgrade URL so the Cloudflare Worker can route the socket to the correct Durable Object. It then waits for the relay's `Challenge` frame and answers it — `Claim` for a name with no owner yet, `Prove` for one it already owns:

```
proof = HMAC-SHA256(secret, nonce ‖ subdomain)
```

The 32-byte secret is supplied as base64 in `ALEX_TUNNEL_SECRET` (or
`--tunnel-secret`). The environment variable is preferred so the secret does
not appear in the process table alongside the public hostname. Electron
generates and stores it; see `04-electron-integration.md`.

A client with no secret refuses to register rather than registering
unauthenticated. If the relay reports the name as already claimed and the
client holds no secret, it fails with a message telling the owner to
regenerate the public URL — which claims a fresh, provable name.

If the relay does not send a `Challenge` within 15 seconds, the client
reports a probable version mismatch rather than hanging.

| Flag | Default | Description |
|------|---------|-------------|
| `--subdomain` | (required) | Three-word subdomain to register |
| `--relay-url` | (required) | WebSocket URL of the relay |
| `--local-addr` | `127.0.0.1:3210` | Local address to forward requests to |

## Reconnect Behavior

The client uses exponential backoff when the WebSocket connection drops:

1. Initial delay: **5 seconds**
2. Each failure doubles the delay
3. Maximum delay: **60 seconds**
4. On successful reconnect, delay resets to 5 seconds
5. The subdomain's ownership record persists across disconnects; each reconnect proves it again against a fresh nonce
6. Losing the connection aborts every in-flight local request, and a `Cancel` frame from the relay aborts one

## Local Forwarding

When the client receives an `HttpRequest` frame:

1. Build an `http::Request` from the frame's method, URI, headers, and body
2. Send it to `http://127.0.0.1:3210` via hyper
3. Read the response status and headers, send `HttpResponse` frame
4. Stream the response body in **64 KB chunks** as `ResponseChunk` frames
5. Send `ResponseEnd` when the body is fully consumed

Streaming avoids buffering entire files (EPUBs, PDFs) in memory.

## Subdomain Generation

`wordlist.rs` contains ~500 adjectives and ~500 nouns. `generate_subdomain()` picks three words at random (adjective-adjective-noun pattern) and joins them with hyphens.

This gives ~500 x 500 x 500 = **125 million** possible subdomains. Note that
randomness is not the security property: a name stops being secret the moment
its URL is shared. What keeps a name yours is the ownership proof above. The
subdomain and its secret are persisted together in the Electron store so both
remain stable across restarts.

Concurrency is capped: at most 32 requests are forwarded to the local server
at once, and the rest wait rather than spawning unbounded tasks.

## Dependencies Added to `watcher-rs/Cargo.toml`

```toml
tokio-tungstenite = { version = "0.26", features = ["rustls-tls-native-roots"] }
hyper = { version = "1", features = ["client", "http1"] }
hyper-util = { version = "0.1", features = ["client-legacy", "tokio"] }
http-body-util = "0.1"
bincode = "1"
rand = "0.9"
futures-util = "0.3"
```
