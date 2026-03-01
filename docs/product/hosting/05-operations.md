# Operations Guide

## Prerequisites

- A VPS with a public IP (e.g., DigitalOcean, Hetzner, Fly.io)
- A domain with DNS managed by Cloudflare (for wildcard TLS)
- Rust toolchain (`rustup`) on both the VPS and the development machine

## 1. DNS Setup

The marketing site lives at the apex domain (`alexreader.app`). Tunnel subdomains use a wildcard record pointing to the relay VPS. These don't conflict — a wildcard record never matches the apex.

Create these DNS records in Cloudflare:

| Type | Name | Content | Proxy | Purpose |
|------|------|---------|-------|---------|
| A (or CNAME) | `@` | Marketing host | Per your setup | `alexreader.app` — marketing site |
| A | `*` | `<VPS_IP>` | DNS only (gray cloud) | `<subdomain>.alexreader.app` — tunnel traffic |

Caddy handles TLS for the wildcard, so the wildcard record must be DNS-only (gray cloud, no Cloudflare proxy).

### Protecting other subdomains

The wildcard catches **all** subdomains not covered by an explicit record. If you use other subdomains (e.g., `www`, `docs`, `api`), add explicit A or CNAME records for them — explicit records take precedence over the wildcard:

| Type | Name | Content | Purpose |
|------|------|---------|---------|
| CNAME | `www` | Marketing host | Keeps `www.alexreader.app` on the marketing site |
| A | `api` | API server IP | Prevents `api.alexreader.app` from hitting the relay |

Any subdomain without an explicit record will route to the relay VPS and be treated as a tunnel subdomain.

## 2. Build the Relay

On the VPS (or cross-compile and copy the binary):

```bash
cd alex-relay
cargo build --release
```

The binary is at `alex-relay/target/release/alex-relay`.

### Cross-compiling (optional)

If building on macOS for a Linux VPS:

```bash
# Install the target
rustup target add x86_64-unknown-linux-gnu

# Build (requires a linker — use cross or zig)
cargo install cross
cross build --release --target x86_64-unknown-linux-gnu
```

Copy the binary to the VPS:

```bash
scp target/x86_64-unknown-linux-gnu/release/alex-relay user@vps:/opt/alex-relay/
```

## 3. Install and Configure Caddy

Install Caddy with the Cloudflare DNS plugin (required for wildcard certs):

```bash
# On the VPS
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudflare.com/apt/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/cloudflare-archive-keyring.gpg

# Install xcaddy to build Caddy with plugins
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
xcaddy build --with github.com/caddy-dns/cloudflare
sudo mv caddy /usr/bin/caddy
```

Create `/etc/caddy/Caddyfile`:

```
*.alexreader.app {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    reverse_proxy 127.0.0.1:8080
}
```

Create a Cloudflare API token with **Zone > DNS > Edit** permission for your domain, then set it:

```bash
# /etc/systemd/system/caddy.service.d/override.conf
[Service]
Environment=CF_API_TOKEN=your-cloudflare-api-token-here
```

Start Caddy:

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

Verify the wildcard cert is issued:

```bash
sudo journalctl -u caddy -f
# Look for "certificate obtained successfully" for *.alexreader.app
```

## 4. Run the Relay as a Service

Create `/etc/systemd/system/alex-relay.service`:

```ini
[Unit]
Description=Alex Relay Server
After=network.target

[Service]
Type=simple
User=alex
ExecStart=/opt/alex-relay/alex-relay --listen-addr 0.0.0.0:8080 --domain alexreader.app
Restart=always
RestartSec=5
Environment=RUST_LOG=alex_relay=info

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /bin/false alex  # service user
sudo systemctl daemon-reload
sudo systemctl enable alex-relay
sudo systemctl start alex-relay
```

Check it's running:

```bash
sudo systemctl status alex-relay
curl -s http://127.0.0.1:8080/  # should return "no tunnel found"
```

## 5. Build the Client (watcher-rs)

On the development machine, rebuild watcher-rs with the new tunnel module:

```bash
cd watcher-rs
cargo build --release
```

### Manual test

Start a local Next.js server on port 3210, then:

```bash
./target/release/watcher-rs tunnel \
  --subdomain test-my-tunnel \
  --relay-url wss://relay.alexreader.app/_tunnel/ws \
  --local-addr 127.0.0.1:3210
```

You should see:

```
connecting to relay at wss://relay.alexreader.app/_tunnel/ws (subdomain: test-my-tunnel)
registered as test-my-tunnel
```

Visit `https://test-my-tunnel.alexreader.app` in a browser to verify.

## 6. Electron Integration

No additional setup is needed for end users. When they toggle "Public Access" in Admin > Users:

1. A subdomain is generated and saved to the Electron store (`~/<userData>/config.json`)
2. The tunnel process is spawned as a child of the Electron app
3. The public URL is displayed with a copy button

The tunnel auto-starts on subsequent app launches if it was previously enabled.

### Changing the relay URL

The relay URL is hardcoded in `electron/main.ts` as `RELAY_URL`. To point to a different relay:

```typescript
const RELAY_URL = 'wss://relay.yourdomain.com/_tunnel/ws';
const TUNNEL_DOMAIN = 'yourdomain.com';
```

Rebuild the Electron app after changing these values.

## 7. Monitoring

### Relay logs

```bash
sudo journalctl -u alex-relay -f
```

Key log lines:
- `client registered` — a tunnel client connected
- `client disconnected` — a tunnel client dropped

### Caddy logs

```bash
sudo journalctl -u caddy -f
```

### Client-side

Tunnel output is logged to stderr with `[Tunnel]` prefix in the Electron console.

## 8. Firewall

The VPS needs:

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | HTTPS (Caddy) |
| 80 | TCP | HTTP (Caddy ACME challenge redirect) |

The relay port (8080) should **not** be exposed publicly — Caddy reverse-proxies to it on localhost.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 9. Updating

### Relay

```bash
cd alex-relay
cargo build --release
sudo systemctl restart alex-relay
```

Connected clients will reconnect automatically after the relay restarts (exponential backoff, 5s to 60s).

### Client

Rebuild watcher-rs and package the new binary with the Electron app. Existing tunnel connections will use the new binary on next app restart.
