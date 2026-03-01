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
