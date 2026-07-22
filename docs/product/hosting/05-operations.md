# Operations Guide

## Prerequisites

- A Cloudflare account with the `alexreader.app` zone.
- A Workers Free or Paid plan. This relay uses the SQLite-backed Durable Objects supported by both plans; check the Free plan's daily request limits before production use.
- Node.js and pnpm for deployment.
- Wrangler authenticated with an account that can deploy Workers and configure routes.

No VPS, Caddy installation, public server ports, or relay Rust toolchain is required.

## 1. DNS Setup

The Worker uses a wildcard route, `*.alexreader.app/*`. Cloudflare requires a proxied DNS record for hostnames matched by a Worker route.

Create or change the wildcard record in Cloudflare DNS:

| Type | Name | Content | Proxy | Purpose |
| --- | --- | --- | --- | --- |
| AAAA | `*` | `100::` | Proxied (orange cloud) | Sends all otherwise-unmatched subdomains to Cloudflare; the Worker route answers before an origin is used |

The apex marketing site is unaffected because `*.alexreader.app/*` does not match `alexreader.app`.

The wildcard Worker route can match other proxied subdomains too. Protect `www`, `docs`, `api`, and similar hosts with a more-specific Worker route or leave their explicit DNS record unproxied when appropriate. `relay.alexreader.app` is intentionally handled by this Worker for `/_tunnel/ws`.

## 2. Authenticate Wrangler

From `alex-relay/`:

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

For CI, use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` instead of an interactive login. The API token needs permission to edit Workers scripts, Durable Objects, and Workers routes for the zone.

## 3. Validate and Deploy

From the repository root:

```bash
pnpm install
pnpm --filter @alex/relay typecheck
pnpm --filter @alex/relay test
pnpm --filter @alex/relay deploy
```

The first deploy applies Durable Object migration `v1` and installs the wildcard route from `wrangler.jsonc`. Later deploys update the Worker without requiring a server restart; connected desktop clients reconnect automatically if Cloudflare closes a socket during rollout.

## 4. Build the Updated Desktop Client

The Cloudflare relay requires the version of `watcher-rs` that adds `?subdomain=...` to the WebSocket upgrade URL:

```bash
pnpm watcher:build
```

Package and distribute a new Electron build before retiring any compatibility deployment of the old relay.

## 5. Manual End-to-End Test

Stop `pnpm electron:dev`, then start the local web app on the desktop port:

```bash
pnpm next dev -p 3210 -H 127.0.0.1
```

In another terminal:

```bash
./watcher-rs/target/release/watcher-rs tunnel \
  --subdomain test-my-tunnel \
  --relay-url wss://relay.alexreader.app/_tunnel/ws \
  --local-addr 127.0.0.1:3210
```

The log should report `registered as test-my-tunnel`. Visit `https://test-my-tunnel.alexreader.app` and verify navigation plus a PDF or EPUB response.

## 6. Electron Integration

No additional end-user setup is needed. Enabling **Public Access** starts the tunnel child process, persists the generated subdomain, and displays its public URL. The configured relay constants remain in `electron/main.ts`:

```typescript
const RELAY_URL = "wss://relay.alexreader.app/_tunnel/ws";
const TUNNEL_DOMAIN = "alexreader.app";
```

The Rust client appends the subdomain query parameter; do not include it in `RELAY_URL`.

## 7. Monitoring

Tail deployed logs with:

```bash
cd alex-relay
pnpm exec wrangler tail
```

The Worker emits structured fields for tunnel connections, disconnects, WebSocket errors, invalid frames, and failed request sends. Cloudflare's Workers dashboard also shows request/error metrics because observability is enabled in `wrangler.jsonc`.

Useful checks:

```bash
curl -i https://unknown-tunnel.alexreader.app/
# 502 tunnel not connected

curl -i https://relay.alexreader.app/_tunnel/ws
# 426 expected a WebSocket upgrade
```

## 8. Updating or Rolling Back

Deploy the current checkout:

```bash
pnpm --filter @alex/relay deploy
```

Use Cloudflare's Workers deployments UI or Wrangler deployment commands to inspect versions and roll back. Do not remove or rename the `v1` Durable Object migration after it has reached production; add a new migration tag for future storage/class changes.
