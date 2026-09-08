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
pnpm typecheck:relay
pnpm test:relay
pnpm --filter @alex/relay deploy
```

The first deploy applies Durable Object migration `v1` and installs the wildcard route from `wrangler.jsonc`. Later deploys update the Worker without requiring a server restart; connected desktop clients reconnect automatically if Cloudflare closes a socket during rollout.

## 4. Build the Updated Desktop Client

The relay requires a `watcher-rs` that speaks tunnel protocol v2 — it adds
`?subdomain=...` to the WebSocket upgrade URL *and* answers the relay's
ownership challenge:

```bash
pnpm watcher:build
```

### Rollout ordering (protocol v2)

The two halves are deliberately incompatible, and both directions fail with a
clear message rather than degrading to unauthenticated registration:

- A **v1 client against a v2 relay** gets
  `registration rejected: this relay requires tunnel protocol v2` and stops.
- A **v2 client against a v1 relay** never receives a `Challenge`, and after
  15 seconds reports a probable version mismatch.

There is therefore no compatibility window: deploy the Worker and distribute
the desktop build together, and expect public access to be down for owners
who have not updated. Announce that before deploying.

### Existing names are rotated, not migrated

A name claimed under v1 has no ownership record, and while its owner was
offline anyone could have claimed it. It cannot be proven as anyone's, so
Alex rotates it: `enableTunnel` generates a new name and secret, and the UI
explains that the public URL changed. Owners must reshare any collection
links they had distributed.

Do **not** hand v1 names to the first client that reconnects after the
upgrade — that just moves the takeover race rather than closing it.

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

Supply the ownership secret in the environment:

```bash
export ALEX_TUNNEL_SECRET="$(openssl rand -base64 32)"
```

The log should report `registered as test-my-tunnel (name claimed)` on the
first run and `(ownership proven)` on subsequent runs with the same secret.
Visit `https://test-my-tunnel.alexreader.app` and verify navigation plus a PDF
or EPUB response.

Keep that secret if you want the name again: a claimed name cannot be
re-registered without it. To take a test name out of service, simply stop
using it — the ownership record stays, which is the point.

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

curl -i https://relay.alexreader.app/_tunnel/ws -H 'Upgrade: websocket'
# 400 a valid subdomain query parameter is required
```

The Worker logs `tunnel name claimed`, `tunnel ownership proof rejected` and
`tunnel ownership secret rotated` alongside the existing connection events. A
run of `tunnel ownership proof rejected` for one subdomain is somebody
attempting a takeover of that name.

## 8. Updating or Rolling Back

Deploy the current checkout:

```bash
pnpm --filter @alex/relay deploy
```

Use Cloudflare's Workers deployments UI or Wrangler deployment commands to
inspect versions and roll back. Do not remove or rename the `v1` Durable
Object migration after it has reached production; add a new migration tag for
future storage/class changes.

**Rolling back past protocol v2 needs care.** Ownership records live in
Durable Object storage under the key `owner`.

- **Do not delete them.** They are the only thing standing between a public
  hostname and whoever connects to it next. A rollback that erases them
  reopens the takeover the v2 protocol closes.
- A rolled-back v1 relay ignores them, and v2 clients will fail to register
  against it — so roll the desktop client back too, or leave public access
  disabled until you roll forward.
- Rolling forward again works without owner action: the stored secret still
  matches the one the desktop app holds.
