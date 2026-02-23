# Hosted Alex: Deployment Plan

## Current Architecture (as-is)

```
┌─────────────────────────────────────┐
│  Docker Container                   │
│                                     │
│  Next.js (PID 1)  ←──JSON/stdin──→  watcher-rs (background)
│   ├── NextAuth (credentials)        │  ├── notify::Watcher on /app/data/library
│   ├── API routes (file serving,     │  ├── SHA-256 dedup
│   │   progress, collections)        │  ├── PDF/EPUB metadata extraction
│   └── spawns watcher-rs for DB ops  │  └── cover generation
│                                     │
│  SQLite @ /app/data/library.db      │
│  Books  @ /app/data/library/        │
│  Covers @ /app/data/covers/         │
└─────────────────────────────────────┘
```

Key observation: **one container = one user's complete, self-contained library**.
The entire app already works as a single-tenant unit. The Docker image, the
watcher, the DB — everything assumes a single isolated instance.

---

## Strategy: Don't Make It Multi-Tenant

The simplest path is to **keep Alex single-tenant and run one instance per user**.

Instead of rewriting the app for multi-tenancy (shared DB, per-request tenant
resolution, watcher multiplexing), we treat the current Docker image as a
"unit of deployment" and orchestrate many copies of it.

This means **zero changes to the Alex codebase** for the core hosting story.

---

## Architecture: Fly Machines + R2

[Fly Machines](https://fly.io/docs/machines/) are lightweight VMs that:
- Boot in <1 second
- Scale to zero when idle (you pay nothing)
- Have persistent volumes that survive restarts
- Can be provisioned/destroyed via REST API
- Are individually addressable via Fly Proxy

```
                        ┌──────────────────────────┐
                        │  Control Plane            │
                        │  (always-on, single app)  │
                        │                           │
                        │  - Signup / billing        │
                        │  - Provisions Machines     │
                        │  - Provisions R2 buckets   │
                        │  - DNS routing             │
                        └────────┬─────────────────┘
                                 │ Fly Machines API
                                 │ Cloudflare API
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                     ▼
    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │  alice.alex   │    │  bob.alex     │    │  carol.alex   │
    │  ┌──────────┐ │    │  ┌──────────┐ │    │  ┌──────────┐ │
    │  │ Alex     │ │    │  │ Alex     │ │    │  │ Alex     │ │
    │  │ (same    │ │    │  │ (same    │ │    │  │ (same    │ │
    │  │  Docker  │ │    │  │  Docker  │ │    │  │  Docker  │ │
    │  │  image)  │ │    │  │  image)  │ │    │  │  image)  │ │
    │  └──────────┘ │    │  └──────────┘ │    │  └──────────┘ │
    │  Volume: 1 GB │    │  Volume: 1 GB │    │  Volume: 1 GB │
    └───────┬───────┘    └───────┬───────┘    └───────┬───────┘
            │                    │                     │
            ▼                    ▼                     ▼
    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │  R2: alice   │    │  R2: bob     │    │  R2: carol   │
    │  (durable)   │    │  (durable)   │    │  (durable)   │
    └──────────────┘    └──────────────┘    └──────────────┘
```

### Why This Works

| Concern | How it's solved |
|---------|----------------|
| Isolation | Each user is a separate VM + separate DB + separate R2 bucket |
| Cost at idle | Fly Machines scale to zero — idle users cost nothing |
| Cold start | <1s Machine wake + idempotent `db:push && db:seed` already in CMD |
| Data durability | R2 is source of truth; Fly volume is a fast local cache |
| Code changes to Alex | **None** for the base hosting story |
| Auth | Each instance has its own NextAuth + own users table (just the owner) |
| Scaling | Thousands of Machines are routine on Fly |

---

## Components

### 1. Control Plane (new, small app)

A thin web app (could itself be a Fly app, or a Cloudflare Worker + Pages).
Responsibilities:

- **Signup**: email/password or OAuth
- **Billing**: Stripe subscription (free tier, $5/mo, $10/mo)
- **Provisioning**: on signup, calls:
  1. Cloudflare API → create R2 bucket `alex-{user_id}`
  2. Cloudflare API → create R2 API token scoped to that bucket
  3. Fly Machines API → create Machine from `jamesacklin/alex:latest`
     with a 1 GB persistent volume and env vars
  4. Fly Machines API → allocate `{username}.alexreader.com`
- **Health / management dashboard**: list users, usage, pause/resume instances
- **Storage enforcement**: periodic check of R2 bucket size vs plan limits

The control plane's database is a small Postgres (or even Turso/D1) holding:
```
users: id, email, stripe_id, plan, fly_machine_id, r2_bucket_name, created_at
```

That's it. ~100 lines of schema.

### 2. User Instance (unchanged Alex Docker image)

The exact image from `jamesacklin/alex:latest`. The only new thing is
env vars injected at Machine creation time:

```bash
# Standard Alex config (already exists)
DATABASE_PATH=/app/data/library.db
LIBRARY_PATH=/app/data/library
NEXTAUTH_SECRET=<per-user-generated-secret>
NEXTAUTH_URL=https://{username}.alexreader.com

# New: R2 sync config (used by a small sync sidecar script)
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=alex-{user_id}
R2_ACCESS_KEY_ID=<scoped-token>
R2_SECRET_ACCESS_KEY=<scoped-secret>
```

### 3. R2 Bucket (one per user)

Each bucket stores the user's actual book files:
```
alex-{user_id}/
  books/
    some-book.pdf
    another-book.epub
  covers/
    uuid.webp
```

R2 is the **durable source of truth**. The Fly volume is a local cache that
makes reads fast and keeps the filesystem watcher happy.

---

## Key Flows

### Signup

```
1. User signs up on control plane
2. Control plane creates R2 bucket via Cloudflare API
3. Control plane creates Fly Machine:
     fly machines create \
       --app alex-hosted \
       --image jamesacklin/alex:latest \
       --vm-size shared-cpu-1x \
       --vm-memory 256 \
       --volume vol_xxx:/app/data \
       --env DATABASE_PATH=/app/data/library.db \
       --env LIBRARY_PATH=/app/data/library \
       --env NEXTAUTH_SECRET=<generated> \
       --env R2_BUCKET=alex-<uid> \
       ...
4. Control plane sets up routing: {username}.alexreader.com → Machine
5. User gets redirect to their instance, sets their password on first visit
```

### Upload (only new code in Alex — small)

```
1. User drags PDF/EPUB into the Alex UI
2. POST /api/upload → Next.js API route
3. Server writes file to /app/data/library/{filename}
   → watcher-rs picks it up immediately (existing flow, unchanged)
4. Server also uploads to R2 bucket (background, fire-and-forget)
   → ensures durability beyond the Fly volume
```

This is the **only new API route** needed in Alex: a ~40-line upload handler
that writes to local disk + R2.

### Reading (unchanged)

```
1. User opens a book
2. GET /api/books/{id}/file → streams from local filesystem (existing code)
3. No R2 involvement — local volume has the file
```

### Cold Start (Machine wakes from sleep)

```
1. Request arrives at {username}.alexreader.com
2. Fly Proxy wakes the Machine (~300ms-1s)
3. Container CMD runs: db:push && db:seed && watcher-rs & node server.js
4. If volume is intact (normal case): everything is already there, ready
5. If volume was lost (rare, Machine replacement):
   - A startup script syncs R2 → local before starting the server
   - Watcher re-scans, re-indexes into fresh SQLite DB
   - Takes seconds for a typical library
```

### Teardown (user cancels)

```
1. Control plane receives Stripe cancellation webhook
2. Optionally: export/download window (30 days)
3. Destroy Fly Machine via API
4. Delete R2 bucket via Cloudflare API
5. Remove user row from control plane DB
```

---

## What Changes in the Alex Codebase

Only two small additions. Everything else stays the same.

### 1. Upload API route (~40 lines)

`POST /api/upload` — accepts a multipart file, writes to `LIBRARY_PATH`,
and (if `R2_BUCKET` env is set) also PUTs to R2 via the S3-compatible API.

```typescript
// Pseudocode
export async function POST(req) {
  const session = await auth();
  if (!session) return 401;

  const formData = await req.formData();
  const file = formData.get('file');

  // Write to local filesystem (watcher picks it up)
  const dest = path.join(LIBRARY_PATH, file.name);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));

  // If R2 configured, also persist there
  if (process.env.R2_BUCKET) {
    await s3Client.putObject({ Bucket: R2_BUCKET, Key: `books/${file.name}`, Body: ... });
  }

  return { ok: true };
}
```

### 2. Startup sync script (~30 lines)

A shell script or small Node script in the Docker CMD that runs before
the server starts. If the local volume is empty but R2 has files, it
syncs them down:

```bash
# Added to Dockerfile CMD, before the existing commands
if [ -n "$R2_BUCKET" ] && [ -z "$(ls -A /app/data/library 2>/dev/null)" ]; then
  echo "Syncing from R2..."
  rclone sync r2:$R2_BUCKET/books/ /app/data/library/ --config /dev/null \
    --s3-provider Cloudflare --s3-access-key-id $R2_ACCESS_KEY_ID \
    --s3-secret-access-key $R2_SECRET_ACCESS_KEY --s3-endpoint $R2_ENDPOINT
fi
```

That's it. Two small additions. The rest of Alex is unchanged.

---

## Cost Model

### Per-user (Fly + R2)

| Component | Idle user | Active user (casual) | Heavy user |
|-----------|-----------|---------------------|------------|
| Fly Machine (shared-cpu-1x, 256MB) | $0 (stopped) | ~$1.94/mo (always on) | ~$1.94/mo |
| Fly volume (1 GB) | $0.15/mo | $0.15/mo | $0.60/mo (4 GB) |
| R2 storage (median 1 GB) | $0.015/mo | $0.015/mo | $0.06/mo |
| R2 operations | ~$0 | ~$0 | ~$0 |
| **Total** | **~$0.17/mo** | **~$2.11/mo** | **~$2.60/mo** |

Most users are idle most of the time — they read in sessions, not 24/7.
A realistic blended average is probably **~$0.50-1.00/user/month**.

### Pricing tiers

| Plan | Price | Storage | Margin (at blended $0.75 COGS) |
|------|-------|---------|-------------------------------|
| Free | $0 | 250 MB | Loss leader (covered by R2 free tier) |
| Reader | $5/mo | 5 GB | ~85% |
| Library | $10/mo | 25 GB | ~93% |

### Platform costs (fixed)

| Component | Cost |
|-----------|------|
| Control plane (Fly, always-on) | ~$5/mo |
| Control plane DB (Turso free tier or small Postgres) | $0-15/mo |
| Domain + DNS | ~$10/year |
| **Total fixed** | **~$10-25/mo** |

Breaks even at ~5 paid users.

---

## Alternatives Considered

### Container-per-user on a single VPS (Docker Compose / Coolify)
- Simpler initially, but no scale-to-zero — idle users consume RAM
- 100 users × 256 MB = 25 GB RAM needed even when idle
- No auto-wake; containers must stay running
- **Verdict**: doesn't scale past ~50 users on a single box

### True multi-tenancy (shared process, per-request DB switching)
- Requires rewriting DB layer to be tenant-aware
- Watcher must be multiplexed or run per-tenant
- SQLite doesn't love being swapped per-request in a shared process
- Months of work, brittle, complex
- **Verdict**: over-engineering for the foreseeable user count

### Kubernetes
- Same idea as Fly Machines but much more operational overhead
- Need to manage the cluster, ingress, volume provisioning, scaling
- **Verdict**: too complex for this stage

### Fly Machines (chosen)
- Purpose-built for exactly this pattern
- REST API for provisioning
- Scale to zero
- Persistent volumes
- Built-in TLS + routing
- **Verdict**: right tool for the job, minimal operational overhead

---

## Implementation Sequence

### Phase 1: Upload + R2 backup (in Alex codebase)
1. Add `@aws-sdk/client-s3` dependency
2. Create `POST /api/upload` route
3. Add R2 upload on file write (when `R2_BUCKET` env is set)
4. Add startup sync script to Dockerfile CMD

### Phase 2: Control Plane MVP
1. Scaffold small Next.js app (or Cloudflare Pages)
2. Signup flow (email + password)
3. Fly Machines API integration (create/start/stop/destroy)
4. Cloudflare R2 API integration (create bucket, scoped tokens)
5. Subdomain routing via Fly Proxy
6. Basic admin dashboard

### Phase 3: Billing
1. Stripe integration (subscriptions, metering)
2. Plan enforcement (storage limits checked via R2 API)
3. Grace period on cancellation
4. Usage dashboard for users

### Phase 4: Polish
1. Custom domain support (user brings their own domain)
2. Data export (download entire library as zip)
3. Migration from self-hosted → hosted (upload existing DB + files)
4. Monitoring + alerting (Machine health, R2 usage)
