# Alex Relay on Cloudflare Workers

The Alex reverse-tunnel relay is a Cloudflare Worker backed by one hibernatable Durable Object per public subdomain. It preserves the desktop client's existing Rust/bincode protocol while removing the VPS, Caddy, and systemd deployment.

```bash
pnpm install
pnpm --filter @alex/relay typecheck
pnpm --filter @alex/relay test
pnpm --filter @alex/relay deploy
```

Before deploying, the `alexreader.app` Cloudflare zone needs a proxied wildcard DNS record. See [the operations guide](../docs/product/hosting/05-operations.md) for DNS, authentication, deployment, and end-to-end verification.
