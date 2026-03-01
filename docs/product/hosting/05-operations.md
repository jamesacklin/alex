# Operations Guide

## Prerequisites

- A VPS with a public IP (e.g., DigitalOcean, Hetzner, Fly.io)
- A domain with DNS managed by Cloudflare (for wildcard TLS)
- Rust toolchain (`rustup`) on both the VPS and the development machine

## 1. DNS Setup

The marketing site lives at the apex domain (`alexreader.app`). Tunnel subdomains use a wildcard record pointing to the relay VPS. These don't conflict — a wildcard record never matches the apex.

Create these DNS records in Cloudflare:

| Type         | Name | Content        | Proxy                 | Purpose                                       |
| ------------ | ---- | -------------- | --------------------- | --------------------------------------------- |
| A (or CNAME) | `@`  | Marketing host | Per your setup        | `alexreader.app` — marketing site             |
| A            | `*`  | `<VPS_IP>`     | DNS only (gray cloud) | `<subdomain>.alexreader.app` — tunnel traffic |

Caddy handles TLS for the wildcard, so the wildcard record must be DNS-only (gray cloud, no Cloudflare proxy).

### Protecting other subdomains

The wildcard catches **all** subdomains not covered by an explicit record. If you use other subdomains (e.g., `www`, `docs`, `api`), add explicit A or CNAME records for them — explicit records take precedence over the wildcard:

| Type  | Name  | Content        | Purpose                                              |
| ----- | ----- | -------------- | ---------------------------------------------------- |
| CNAME | `www` | Marketing host | Keeps `www.alexreader.app` on the marketing site     |
| A     | `api` | API server IP  | Prevents `api.alexreader.app` from hitting the relay |

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

# Install zig + cargo-zigbuild
brew install zig
cargo install cargo-zigbuild

# Build using Zig as the linker
cargo zigbuild --release --target x86_64-unknown-linux-gnu
```

Copy the binary to the VPS:

```bash
scp target/x86_64-unknown-linux-gnu/release/alex-relay user@vps:/opt/alex-relay/
```

## 3. Install and Configure Caddy

Install Caddy and add the Cloudflare DNS plugin (required for wildcard certs):

```bash
# On the VPS
# If Caddy is installed via snap, remove it to avoid conflicts with apt/systemd setup
if snap list caddy >/dev/null 2>&1; then sudo snap remove caddy; fi

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo apt update
sudo apt install -y caddy

# Add the Cloudflare DNS module to the installed Caddy binary
# Stop running instances first; add-package starts a temporary Caddy process
sudo systemctl stop caddy 2>/dev/null || true
sudo pkill -x caddy 2>/dev/null || true
sudo caddy add-package github.com/caddy-dns/cloudflare
sudo caddy list-modules | grep dns.providers.cloudflare
```

`caddy add-package` is the quickest path and is currently marked experimental by Caddy. If you want strict reproducibility/pinning, use an `xcaddy` build flow instead.
If `systemctl status caddy` says unit not found, Caddy was not installed as an apt package (or install failed); reinstall with `sudo apt install --reinstall caddy`.

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
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/override.conf > /dev/null <<'EOF'
[Service]
Environment=CF_API_TOKEN=your-cloudflare-api-token-here
EOF
```

Start Caddy:

```bash
sudo systemctl daemon-reload
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

Run this mode without Electron (`pnpm electron:dev` should be stopped). Start a local Next.js server on port 3210, then:

```bash
pnpm next dev -p 3210 -H 127.0.0.1
```

In a second terminal, run:

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

For local development, `pnpm electron:dev` starts its own Next.js server on `127.0.0.1:3210`. Do not run a separate `next dev` or manual `watcher-rs tunnel` against the same port at the same time.

### Changing the relay URL

The relay URL is hardcoded in `electron/main.ts` as `RELAY_URL`. To point to a different relay:

```typescript
const RELAY_URL = "wss://relay.yourdomain.com/_tunnel/ws";
const TUNNEL_DOMAIN = "yourdomain.com";
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

| Port | Protocol | Purpose                              |
| ---- | -------- | ------------------------------------ |
| 443  | TCP      | HTTPS (Caddy)                        |
| 80   | TCP      | HTTP (Caddy ACME challenge redirect) |

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
