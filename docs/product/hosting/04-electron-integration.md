# Electron Integration

## Overview

The Electron main process manages the tunnel client as a child process (alongside the existing watcher process). The admin UI provides a toggle to enable/disable public access and displays the public URL.

## Store Schema Changes (`electron/store.ts`)

Two new fields added to `StoreSchema`:

```typescript
tunnelEnabled: boolean;    // default: false
tunnelSubdomain: string;   // default: '' (generated on first enable)
```

## Main Process Changes (`electron/main.ts`)

### Process Management

A new `tunnelProcess` variable (alongside `watcherProcess`) with two functions:

- **`startTunnel()`**: Spawns `watcher-rs tunnel --subdomain <sub> --relay-url <url> --local-addr 127.0.0.1:3210`. Logs stdout/stderr.
- **`stopTunnel()`**: Kills the tunnel process.

### IPC Handlers

| Channel | Returns | Behavior |
|---------|---------|----------|
| `get-tunnel-status` | `{ enabled, subdomain, url }` | Reads store, returns current state |
| `enable-tunnel` | `{ subdomain, url }` | Generates subdomain if empty, saves to store, starts tunnel process |
| `disable-tunnel` | `void` | Sets `tunnelEnabled = false`, stops tunnel process |
| `regenerate-tunnel-subdomain` | `{ subdomain, url }` | Generates new subdomain, restarts tunnel if running |

### Auto-Start

On app launch, if `tunnelEnabled` is `true` in the store, `startTunnel()` is called after the server is ready.

## Preload Changes (`electron/preload.ts`)

New methods exposed on `window.electronAPI`:

```typescript
getTunnelStatus: () => ipcRenderer.invoke('get-tunnel-status'),
enableTunnel: () => ipcRenderer.invoke('enable-tunnel'),
disableTunnel: () => ipcRenderer.invoke('disable-tunnel'),
regenerateTunnelSubdomain: () => ipcRenderer.invoke('regenerate-tunnel-subdomain'),
```

## Admin UI Changes (`src/app/(dashboard)/admin/users/users-table.tsx`)

A new "Public Access" section added to the server URL panel area:

- **Toggle switch**: Enables/disables the tunnel
- **Public URL**: Displayed when enabled, with a copy-to-clipboard button
- **Regenerate URL**: Button to generate a new subdomain (restarts tunnel)
- **Status indicator**: Shows connection state (connecting, connected, disconnected)

## Tunnel ownership state (protocol v2)

The Electron store holds three tunnel fields:

| Key | Meaning |
| --- | --- |
| `tunnelEnabled` | Whether public access is on |
| `tunnelSubdomain` | The public hostname's first label |
| `tunnelSecret` | Base64 32-byte proof of ownership for that name |
| `tunnelOwnershipVersion` | Protocol version the name was claimed under |

`enableTunnel` generates both the name and the secret when either is missing,
and passes the secret to the tunnel process in `ALEX_TUNNEL_SECRET`.
`regenerateTunnelSubdomain` always generates a **new secret alongside the new
name**: reusing the old one would leave the previous name claimable with a
proof we still hold.

### Migration from protocol v1

Names claimed before v2 have no ownership record, and anyone could have
claimed them while the owner was offline. They are therefore **rotated, not
trusted**: `enableTunnel` replaces a name that has no secret and returns
`rotated: true`, and the UI explains that the public URL has changed and why.
Auto-start at launch skips a name with no secret rather than registering it
unauthenticated.

### Preconditions for enabling public access

`enableTunnel` returns `{ error: 'no-remote-credentials' }` until at least one
account can actually log in — that is, one whose `password_hash` is a bcrypt
digest and which is not disabled.

The synthetic desktop principal (`admin@localhost`, id `1`) is deliberately
not such an account: it exists so foreign keys from reading progress and
collections resolve, and it carries a sentinel hash that the credentials
provider refuses. Publishing a login page for it would previously have
published a password that was a matter of public record. The owner creates a
real account in Admin → Users first.

### S3 settings

`get-s3-config` returns the configuration **without** the secret access key,
plus `secretKeyConfigured: boolean`. The secret is stored encrypted with
Electron's `safeStorage` (OS keychain) and never sent to the renderer, which
is the same process that renders book content.

`save-s3-config` validates its payload, treats an unchanged configuration as a
no-op, and verifies connectivity with `watcher-rs s3-check` *before* replacing
a working configuration — restoring the previous one if activation fails. It
does not clear the books table: changing source or rotating a key is not a
request to destroy reading state. Use Admin → Library → Clear library for
that.
