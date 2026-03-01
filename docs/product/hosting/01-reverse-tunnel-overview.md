# Reverse Tunnel — Feature Overview

## Problem

Alex runs as an Electron app on a user's home machine. The built-in Next.js server is only reachable on the local network. Users who want to read their books from outside the house — or share their library with a friend — must manually configure port forwarding on their router, which most people won't do.

## Solution

A built-in reverse tunnel lets any Alex desktop user expose their server at a public URL like `https://gentle-morning-tide.alexreader.app` with a single toggle in the admin UI. No router configuration, no DNS setup, no TLS management.

## User Flow

1. Open **Admin > Users** in the Alex desktop app.
2. Toggle **Public Access** on.
3. A three-word subdomain is generated (e.g., `gentle-morning-tide`).
4. The app displays the public URL and a copy button.
5. Anyone with the URL can access the library over HTTPS.
6. Toggle off to disconnect instantly.

## Architecture

```
Browser → https://gentle-morning-tide.alexreader.app
              ↓
     ┌─────────────────────┐
     │   alex-relay (VPS)  │  Caddy handles TLS (wildcard *.alexreader.app)
     │   axum on :8080     │  Caddy reverse-proxies to :8080
     │   subdomain→client  │
     └────────┬────────────┘
              │ WebSocket (outbound from client)
              │
     ┌────────┴────────────┐
     │   watcher-rs        │  `tunnel` subcommand
     │   tunnel client     │  Forwards HTTP to 127.0.0.1:3210
     └─────────────────────┘
              │
         Next.js :3210
```

### Components

| Component | Location | Role |
|-----------|----------|------|
| **alex-relay** | VPS (`alex-relay/`) | Accepts client WebSocket connections, maps subdomains to clients, proxies incoming HTTP requests over WebSocket |
| **Tunnel client** | Desktop (`watcher-rs/src/tunnel/`) | Connects outbound to relay via WebSocket, receives HTTP requests, forwards them to the local Next.js server, streams responses back |
| **Caddy** | VPS | Terminates TLS for `*.alexreader.app` using wildcard cert (DNS-01 via Cloudflare), reverse-proxies to relay on `:8080` |
| **Electron integration** | Desktop (`electron/`) | Manages tunnel process lifecycle, persists settings, exposes IPC to renderer |
| **Admin UI** | Desktop (`src/app/`) | Toggle, URL display, regenerate button |

### Security Model

- **Subdomain as credential**: Three random words chosen from pools of ~500 each give ~125 million combinations. Unguessable for a small user base.
- **Future hardening**: Add a pre-shared key (PSK) sent as an auth header during WebSocket registration.
- **All traffic over TLS**: Caddy terminates HTTPS; the relay and tunnel communicate over WSS.
- **No inbound ports**: The desktop app only makes outbound WebSocket connections, so no NAT/firewall holes are needed.

## Related Docs

- [02 — Relay Server](./02-relay-server.md)
- [03 — Client Tunnel](./03-client-tunnel.md)
- [04 — Electron Integration](./04-electron-integration.md)
