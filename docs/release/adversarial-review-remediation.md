# Adversarial review remediation

Remediation of the twelve findings in the 6 September 2026 adversarial
review. Baseline reviewed: `42ad185ee7700e4f3846a8e40af9ab7adc3cc9d6` on
`main`, package version 0.6.2.

This document is the acceptance matrix the review asked for: for each
finding, what changed, what test proves it, what was observed, and what
remains unverified.

## Contracts agreed before implementation

The review asked for four contracts to be settled first. They are:

**1. Atomic database operations.** `watcher-rs db transaction` runs a batch of
statements on one connection inside one `BEGIN IMMEDIATE`; any error rolls the
whole batch back. This is the primitive the Node bridge lacked — sending
`BEGIN` and `COMMIT` through separate `execute()` calls is not a transaction,
because each call is its own process and its own connection. Migrations are
versioned, embedded in the binary with `include_str!`, recorded in a
`schema_migrations` ledger, and each is applied inside its own transaction
together with the row that records it. `watcher-rs db migrate` is the single
entry point used by `pnpm db:push`, the Electron main process and the
container entrypoint.

**2. Session revocation.** `users.session_version` is a monotonic counter;
issued JWTs carry the version they were minted with. `authSession()` re-reads
the account on every protected operation and rejects a session whose version
no longer matches, whose account no longer exists, or whose account is
disabled — and takes role and display name from the database rather than the
token, so a demotion takes effect immediately. A password reset, a role change
and a deactivation each bump the version. A token carrying no version at all
is treated as revoked, which deliberately invalidates every session issued by
a pre-fix build.

**3. Source identity and missing-source behaviour.** A local library root is
`Available`, `Missing` or `Unrecognized`. Recognition is a marker file
(`.alex-library`) written into the root after a scan: a root that exists but
carries no marker while the database holds local books is an unmounted volume,
not an emptied library. Orphan cleanup runs only against an `Available` root,
and only deletes a book whose own parent directory is present. S3
reconciliation is scoped by bucket **and prefix**, matching the listing it
diffs against, so narrowing a prefix cannot classify other keys as removed.
Changing source or rotating credentials never deletes book rows; destruction
is the separate, explicitly authorized `POST /api/admin/library/clear`.

**4. Authenticated tunnel registration and cancellation.** Tunnel protocol v2.
The relay stores a 32-byte owner secret per name in Durable Object storage. On
every connection it sends a random nonce, and the client answers with
`HMAC-SHA256(secret, nonce ‖ subdomain)`. Names with no owner can be claimed
once; claimed names require proof; `Rotate` replaces the secret under proof. A
`Cancel` frame runs in both directions. Each accepted socket carries a
monotonic generation, and pending requests remember theirs, so a close event
from a replaced connection cannot fail the live one's work.

## Acceptance matrix

Legend: **Verified** = a test in this repository asserts the fixed behaviour
and was observed passing. **Traced** = the change is made and reviewed but the
specific end-to-end scenario was not executed here; the limitation is stated.

### F01 — Startup restores a publicly known administrator credential (P0)

**Changed.** `src/lib/db/seed.ts` has no default credential: it requires
`ALEX_ADMIN_EMAIL` and `ALEX_ADMIN_PASSWORD`, and inserts only
(`ON CONFLICT(email) DO NOTHING`) so it can never reset an account.
`docker/entrypoint.sh` no longer runs it at all. The login path's implicit
schema bootstrap and implicit administrator creation are gone
(`src/lib/auth/credentials.ts`). The Electron desktop principal is created
with a sentinel `password_hash` (`!`) that is not a bcrypt digest, and
`isLoginCapablePasswordHash` refuses any hash that is not well-formed bcrypt,
so it cannot authenticate over the network. First-run web setup requires a
one-time token printed to the server log and written next to the database
(`src/lib/auth/bootstrap.ts`). Enabling the public tunnel is blocked until an
account that can actually log in exists.

**Verified.** `src/__tests__/auth-boundaries.test.ts` — "F01 — no publicly
known administrator credential" (5 tests) and "F01 — login throttling is
bounded and effective" (2 tests). Confirmed failing against the baseline
behaviour before the fix.

**Limitation.** Existing installations that still hold the default credential
need the remediation procedure below; changing the code does not rotate a
password that may already be known.

### F02 — Anyone can reclaim an offline tunnel name (P0)

**Changed.** Tunnel protocol v2 as described in contract 4, implemented in
`alex-relay/src/index.ts`, `alex-relay/src/protocol.ts`,
`watcher-rs/src/tunnel/auth.rs`, `watcher-rs/src/tunnel/protocol.rs` and
`watcher-rs/src/tunnel/client.rs`. HMAC-SHA256 is implemented on top of the
`sha2` crate the project already depends on, so no lockfile change was needed.
A v1 client is rejected with an explanatory message rather than silently
registered. Sockets that do not register within a deadline are closed.

**Migration:** names claimed before v2 have no ownership proof, and anyone
could have claimed them in the meantime, so they are **rotated rather than
trusted**. Electron generates a new name and a new secret when it finds a
configured name with no secret, and the UI says the URL changed and why.

**Verified.** `alex-relay/test/relay.test.ts` — "tunnel ownership (F02)" (8
tests), including the exact takeover the review reproduced: owner claims,
disconnects, an unrelated client attempts to claim and to prove, both are
refused, and a browser request carrying a session cookie gets 502 rather than
reaching the impostor. Also replay of a captured proof on a later connection,
a proof bound to a different name, secret rotation invalidating the old
secret, and wrong-length secrets. `watcher-rs/src/tunnel/auth.rs` carries RFC
4231 HMAC vectors plus nonce/name/secret specificity tests.

**Limitation.** Not exercised against the deployed Cloudflare relay or across
a real Worker hibernation. Durable Object storage semantics are assumed as
documented.

### F03 — EPUB scripts can cross into application privileges (P0)

**Changed.** `allowScriptedContent` is now `false` in
`src/components/readers/EpubReader.tsx`, so epub.js builds its iframe with
`sandbox="allow-same-origin"` and never appends `allow-scripts`. In Electron:
every IPC handler goes through `handleTrusted`, which requires the sender to
be the main frame of our own window on our own origin; the window denies
`setWindowOpenHandler`, off-origin `will-navigate`, off-origin sub-frame
navigation, `will-attach-webview` and any created window; the default session
refuses all permission, device and permission-check requests; and
`webviewTag` is off.

`sandbox: true` was tried on the renderer and withdrawn. It changes the
preload environment, and every failure in the desktop end-to-end suite
clustered on the tests that go through `window.electronAPI` — which is what
a preload that no longer loads would look like. It is hardening beyond what
this finding requires, and it cannot be validated without a packaged app, so
it is a follow-up to attempt there rather than something to carry
unverified. Context isolation, disabled node integration, IPC sender
validation and the navigation and permission restrictions are what F03
actually turns on, and those stay. `get-s3-config` no longer
returns the secret access key — it returns `secretKeyConfigured: boolean`
instead, and the secret is held in the OS keychain via `safeStorage`. The CSP
gained `frame-src`, `worker-src`, `media-src` and
`Cross-Origin-Opener-Policy`, and `'unsafe-eval'` is now development-only.

**Verified (browser) — and the vulnerability reproduced first.**
`e2e/specs/epub-security.spec.ts` opens a purpose-built hostile EPUB
(`e2e/helpers/make-hostile-epub.js`) in the real reader in Chromium and
asserts that none of inline script, a body `onload`, a `javascript:` URL, an
`img onerror`, a nested `iframe srcdoc`, `<object>`, `<embed>`, SVG
`<script>`, a top-level navigation, a popup, an authenticated `fetch` to
`/api/electron/clear-books` or `/api/users`, or a form post to a privileged
route achieves anything — while the book's text still renders, and a
well-formed book still scrolls and records progress.

The review listed F03 as source-traced, with "browser and packaged Electron
exploit validation remains required". The browser half is now *reproduced*:
running the same test with `allowScriptedContent` restored to `true` fails
with the book's own payloads recorded **on the parent window**:

```
Received
+ Array [
+   "svg-script",
+   "img-onerror",
+   "nested-iframe",
+   "body-onload",
+ ]
```

and the iframe reported `sandbox="allow-same-origin allow-scripts"` — exactly
the combination the review identified. With the fix, the same run passes and
the sandbox is `allow-same-origin` alone.

**Limitation.** **Not validated in a packaged Electron build.** The IPC
sender validation, navigation restrictions, permission handlers and keychain
storage type-check and are reviewed, but no packaged desktop app was built or
driven here. This is the single largest remaining verification gap; see
"Release limitations".

### F04 — An ordinary web user can invoke the desktop library wipe route (P1)

**Changed.** `src/app/api/electron/clear-books/route.ts` returns 404 unless
desktop mode is enabled, and requires the desktop capability token on every
request when it is. The `Host`-substring check is gone: `Host` is
caller-controlled and is not an authorization signal.

**Verified.** `src/__tests__/auth-boundaries.test.ts` — "F04 — the desktop
wipe route is not reachable from the web" (3 tests), covering a localhost
`Host`, a forwarded `Host` that merely contains `localhost`, and the desktop
path with and without the token. Confirmed failing against the baseline route
(both web-mode tests returned 200 and deleted the book).

The same file's "destructive routes require the authority they claim to"
group (5 tests) covers the review's "ordinary reader attempts every
destructive route" sequence at the route and action level: the admin library
wipe refuses a reader, an unauthenticated caller and an auth-error object
while allowing an administrator, and every user-administration action plus
`DELETE /api/users/[id]` refuses a reader.

### F05 — Deleted, demoted or password-reset users retain session authority (P1)

**Changed.** Contract 2. `src/lib/auth/session-authority.ts` holds the
decision; `authSession()` routes through it; `src/lib/auth/middleware-auth.ts`
documents that middleware is a routing gate only.

**Verified.** `src/__tests__/auth-boundaries.test.ts` — "F05 — revoked
authority cannot be replayed" (6 tests): a matching session is accepted; a
session captured before a password reset, before a demotion, for a deleted
account, for a disabled account, or with no version at all is refused.
Confirmed failing against pass-through session handling.

**Note.** This adds one database read per protected operation. That is
deliberate — a cache would reintroduce a revocation window — and the DB
bridge now bounds concurrency, runtime and output per call.

### F06 — First-run admin creation is a check-then-insert race (P1)

**Changed.** `src/app/(auth)/setup/actions.ts` validates its payload with zod
(a server action is a public endpoint regardless of its TypeScript signature),
requires the one-time bootstrap token, and creates the account with a single
`INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)` so the
empty-table check and the insert cannot interleave.

**Verified.** `src/__tests__/auth-boundaries.test.ts` — "F06 — first-run setup
is atomic and owner-authorized" (4 tests): eight concurrent setup requests
produce exactly one administrator; a wrong token is refused; malformed
payloads return controlled errors and create nothing; a second attempt is
refused. Confirmed failing against the baseline action (the race produced
multiple administrators).

### F07 — S3 downloads buffer entire files and can report corruption as success (P1)

**Changed.** One range contract shared by both drivers
(`src/lib/files/range.ts` and `watcher-rs/src/s3/stream.rs`), covering closed,
open-ended, suffix, oversized-end, unsatisfiable and empty-file cases, with
malformed headers ignored per RFC 9110 §14.2. The Rust helper now does a
`HEAD` first so its stdout header can state `object_size` separately from
`content_length`, then streams through `get_object_to_writer` /
`get_object_range_to_writer` into an async stdout instead of buffering the
object. Node parses only the header line (bounded at 64 KiB) and responds
immediately, forwarding the body through a pull-based stream with backpressure
(the child's stdout is paused past 8 buffered chunks). A non-zero child exit,
a short transfer or an over-long transfer **errors the response body** instead
of completing it; a client abort kills the child.

**Verified.** `src/__tests__/serve-book-file.test.ts` (26 tests) and
`watcher-rs/src/s3/stream.rs` (16 tests). The previously-asserted
`Content-Range: bytes 10-14/5` is now `bytes 10-14/1000` — that assertion had
locked the bug in, and reversing it was required. Also covered: the response
exists before the body completes; truncation after headers errors the body;
suffix ranges read from the end; oversized ends clamp; empty files 416 on any
range; a browser cancel kills the helper.

**Limitation.** No large-fixture memory measurement against a real S3
endpoint. The bound is structural (a fixed number of buffered pipe reads) and
documented in the code, but a measured ceiling under load has not been taken.

### F08 — Tunnel HTTP streaming is incomplete and resource use is unbounded (P1)

**Changed.** 204/205/304 and any response to `HEAD` are built with a null
body. The Rust proxy forwards each body chunk as it arrives, splitting only
above 64 KiB, instead of accumulating 64 KiB before sending anything — so SSE
events and keepalives reach the browser promptly and the relay's idle timer
does not expire on a live stream. Bounds: at most 64 pending requests per
tunnel (503 beyond), 8 MiB queued per response and 32 MiB across the tunnel
(exceeding either aborts the response and cancels the client's work), and the
request body limit is enforced *while reading* rather than after buffering.
Cancellation propagates from browser disconnect to the local request. The
relay replaces caller-supplied `x-forwarded-*`, `forwarded`, `x-real-ip` and
every `x-alex-*` header — including the desktop capability token — with
trusted values, and the Rust proxy does the same rather than preserving what
it was given. Concurrency in the client is capped by a semaphore; losing the
connection aborts every in-flight forward.

**Verified.** `alex-relay/test/relay.test.ts` — "HTTP semantics" (10 tests):
the 204 case the review reproduced now returns 204 with a null body rather
than 502; 205, 304 and HEAD likewise; header sanitization; repeated
`Set-Cookie`; prompt delivery of a small SSE chunk before `responseEnd`; an
oversized chunked request rejected with 413; an oversized declared body
rejected up front; a mid-transfer cancel erroring the body; generation
isolation. Plus `watcher-rs/src/tunnel/proxy.rs` header tests.

**Limitation.** Measured memory and concurrency ceilings under sustained
overload were not taken, and recovery after overload was not exercised. The
budgets are asserted as behaviour (a request beyond the cap gets 503), not as
a load-test result.

### F09 — Source maintenance destroys durable reading state (P1)

**Changed.** Contract 3. `watcher-rs/src/handlers/orphan_cleanup.rs` gained
`classify_source`/`mark_source_scanned` and requires an `Available` root plus
a present parent directory before deleting anything.
`electron/paths.ts` no longer `mkdir`s a missing library path — creating it
was what turned an unmounted volume into the empty directory the scanner then
misread. `Database::find_s3_books` takes a prefix. Electron's
`save-s3-config` validates its payload, treats an unchanged configuration as a
no-op, proves connectivity with `watcher-rs s3-check` **before** replacing a
working configuration, restores the previous configuration on failure, and no
longer clears the books table; `switch-to-local-storage` likewise. UI copy and
the confirmation dialog were corrected to match.

**Verified.** `watcher-rs/src/handlers/orphan_cleanup.rs` (5 tests) and
`watcher-rs/tests/integration.rs` — an absent root and an empty unmarked
mountpoint both keep every book record, and cleanup still works normally once
the volume is back; prefix-scoped reconciliation returns only in-scope rows.

**Limitation.** The Electron settings changes were not exercised in a packaged
app or against a real bucket. `s3-check` is a real listing call, but it was
not run against live credentials here.

### F10 — Docker serves requests before successful initialization (P1)

**Changed.** `docker/entrypoint.sh` replaces the inline `CMD`. It validates
required configuration, applies migrations synchronously and exits non-zero on
failure, provisions no account, supervises the watcher alongside the server,
exits when either dies, and forwards SIGTERM/SIGINT to both. `GET /api/health`
reports readiness distinguishing `ok`, `degraded` (schema behind) and
`unavailable` (database unreadable), and the image has a `HEALTHCHECK` using
it. The Rust builder stage now copies the migration files, which the binary
embeds.

**Verified.** `docker/entrypoint.test.sh` (13 checks, run in CI via
`pnpm test:entrypoint`): a failing migration exits non-zero and starts
neither child; **the previous `CMD` shape is reproduced and does start the
server after a failed migration**; a missing `NEXTAUTH_SECRET` is fatal; a
successful start brings up both children and prints first-run guidance
without provisioning anything; SIGTERM stops both; a watcher crash exits with
the watcher's status and stops the server. `src/__tests__/health-api.test.ts`
(4 tests) covers the readiness states.

**Limitation.** **The container image was not built or run here.** The tests
exercise the entrypoint's shell logic directly against stand-in binaries,
which is where the defect was, but a fresh-volume and persisted-volume
container smoke test remains outstanding.

### F11 — Middleware accepts an auth-error object; dependency fixes need triage (P1)

**Changed.** Application decision: `src/middleware.ts` and
`src/lib/auth/session-authority.ts` require a concrete, non-empty
`user.id`, so an auth-error object — which is truthy — is refused.
Dependencies: see docs/release/dependency-baseline.md.

**Verified.** `src/__tests__/auth-boundaries.test.ts` — "F11 — an auth-error
object is not an identity" (2 tests). `pnpm audit --prod` reports no known
vulnerabilities, down from 54 matches; the two remaining advisories in the
full audit have no upstream fix and are waived with reachability notes.
`pnpm audit --prod` is now a CI gate.

### F12 — Database constraints and mutations disagree (P2)

**Changed.** Migration `0004_progress_unique.sql` deduplicates existing
reading progress with a documented tie-breaker (most recent `last_read_at`,
then furthest through the book, then lowest id) and adds a unique index on
`(user_id, book_id)`. The progress route uses an atomic
`INSERT ... ON CONFLICT(user_id, book_id) DO UPDATE`. Account deletion has
explicit semantics in `src/lib/db/accounts.ts` — reading progress and owned
collections go with the account, books never do — executed in one transaction,
and both the API route and the admin action use it. Self-deletion and
self-demotion protections are preserved.

**Verified.** `src/__tests__/data-integrity.test.ts` (11 tests): 20 concurrent
first saves leave exactly one row (both EPUB and PDF paths); the schema
rejects a duplicate pair; a book with progress is still listed once; the bare
`DELETE FROM users` is shown to fail with `FOREIGN KEY constraint failed` on a
used account, while the route and the action both succeed and leave books
intact; the transaction primitive rolls back on failure.
`watcher-rs/src/migrations.rs` covers the dedupe and the fresh/legacy upgrade
paths.

## Additional bounded follow-ups from the review

| Follow-up | Status |
| --- | --- |
| Bound DB subprocess runtime, output and concurrency | **Done.** `src/lib/db/rust.ts`: 16 concurrent children, 30s per call, 64 MiB output cap, all env-overridable. |
| Observable resource budgets for public requests | **Partly done.** The relay enforces and logs pending-request and queued-byte budgets; there is no metrics export. |
| Enforce archive-entry and decoded-image budgets before processing hostile EPUBs | **Not done.** Metadata and cover extraction still read complete decompressed entries. Tracked below. |
| Namespace local reader caches by account; verify logout/account-switch | **Not done.** `localStorage` keys are still `epub-progress:${bookId}` with no account component. Tracked below. |
| Clarify shared-file cache revocation semantics | **Not done.** Tracked below. |

## Release limitations

Stated explicitly rather than omitted from testing.

1. **No packaged Electron build or packaged-app test.** The desktop trust
   boundary changes (IPC sender validation, navigation and permission
   restrictions, keychain-backed secret storage, the non-login desktop
   principal, S3 settings behaviour) type-check and are covered by review, but
   no `.app`/`.exe`/AppImage was produced or driven. F03's Electron half and
   F09's settings half are **Traced, not Verified**.
2. **No container image build or container smoke test.** F10's entrypoint
   logic is verified directly; the image is not.
3. **Electron 34 → 39 was not runtime-tested.** One typing change was needed
   (`app.dock?`). Chromium and Node moved several majors; a packaged launch is
   required before release.
4. **No load or memory measurement.** F07's and F08's resource bounds are
   verified as behaviour, not as measured ceilings.
5. **Not run against the deployed relay.** F02 and F08 are verified against
   the local Workers runtime (`@cloudflare/vitest-pool-workers`).
6. **The three follow-ups marked "Not done" above are open**, including
   archive-entry budgets for hostile EPUB metadata extraction.
7. **Renderer sandboxing (`sandbox: true`) is not enabled**, having been
   tried and withdrawn as described under F03. Worth attempting again against
   a packaged app.
8. **CSP still allows `'unsafe-inline'` for scripts.** Next.js emits inline
   bootstrap and flight-data scripts; removing it requires a per-request nonce
   migration. `'unsafe-eval'` is now development-only. With EPUB-authored
   scripting disabled, the chain F03 described is broken at the iframe rather
   than at the CSP, but this remains a hardening gap.
9. **`cargo audit` and PDFium advisory tracking are not automated.**

## Upgrade and remediation procedure

Do these in order. Take and verify a SQLite backup and a configuration backup
first, and test the upgrade on a copy.

1. **Back up.** `data/library.db` (plus `-wal`/`-shm`), `data/covers`, and
   the Electron `config.json` if this is a desktop install.
2. **Upgrade.** Migrations 0002–0004 are additive except for the two
   deduplications, which delete only rows the new unique indexes could not
   admit. Baseline inference means 0000 is never replayed over live data.
   Verify with `GET /api/health` (`status: "ok"`, `schemaVersion: 4`).
3. **Expect every session to be logged out.** Tokens with no
   `session_version` are treated as revoked. This is intended.
4. **Rotate credentials that may be known.** If this installation ever ran
   with `admin@localhost` / `admin123` — including one that had its password
   changed, since the container restored the default at each start — treat
   that credential as public. Change it in Admin → Users, which also bumps
   `session_version`. If you cannot log in, provision a fresh account with
   `ALEX_ADMIN_EMAIL` / `ALEX_ADMIN_PASSWORD` and `pnpm db:seed`, then remove
   or disable the old one.
5. **Re-enable public access, expecting a new URL.** A tunnel name claimed
   before v2 cannot be proven as yours and is rotated. Reshare any collection
   links you had distributed.
6. **Provision remote credentials on desktop installs.** The desktop
   principal cannot log in. Create an account in Admin → Users before
   enabling the tunnel; the UI blocks enabling until you do.
7. **Set `NEXTAUTH_SECRET`.** The container now refuses to start without it.

### Rollback

Rolling back the application is not sufficient on its own:

- **Database.** Migration 0004 deleted duplicate progress rows. A pre-upgrade
  build works against the newer schema (the extra columns and index are
  additive and its statements do not reference them), but restoring the
  backup discards reading activity since the upgrade. Decide deliberately.
- **Relay ownership.** **Do not erase Durable Object ownership records.** A
  rolled-back v1 client cannot register against a v2 relay, and it will say
  so. Roll the relay back too, or leave public access disabled until you roll
  forward again.
- **Desktop credentials.** Accounts created for remote access survive a
  rollback and remain login-capable. A rolled-back build will also recreate
  the `admin@localhost` account with the default password — remove it again
  after rolling forward.
- **S3 secrets.** Secrets moved into OS keychain storage. A rolled-back build
  reads `secretKey` from `config.json` and will not find it; re-enter the
  secret, or roll forward.

## On the verifier role

The review's plan assigns independent adversarial acceptance to a separate
agent V, explicitly "without relying on the implementation agents' pass
claims". That separation has not been achieved here: the same author wrote
the fixes and the tests.

What was done instead, and is worth something:

- **Every regression was confirmed to fail against the pre-fix behaviour**,
  not merely to pass afterwards. For F04, F05, F06 and F11 the original code
  was temporarily restored and the tests were observed failing. For F03 the
  vulnerable setting was restored and the escape was observed happening. For
  F12 the migration tests exercise the pre-index state directly, and one test
  asserts that the original `DELETE FROM users` still fails as reported.
- **The review's own probe assertions were reversed where they had locked in
  a bug** — most importantly `Content-Range: bytes 10-14/5` in
  `serve-book-file.test.ts`.
- **The browser exploit validation the review could not run was run**, and
  reproduced the vulnerability before closing it.

An independent pass is still worth commissioning, particularly for the
packaged desktop app and a real container.

## Verification summary

Observed on this working tree (Linux, Node 26.5.0, Rust 1.98.1,
pnpm 10.33.2):

| Suite | Baseline at 42ad185 | After |
| --- | --- | --- |
| `pnpm test` (Jest) | 48 passed | 114 passed |
| `cargo test` (watcher-rs) | 17 passed | 77 passed |
| `pnpm test:relay` (Workers) | 6 passed | 25 passed |
| `pnpm test:entrypoint` | did not exist | 13 checks passed |
| `pnpm lint` | passed | passed |
| `pnpm typecheck` / `:electron` / `:relay` | app only, in CI | all three pass, all three gated in CI |
| `pnpm build` | passed | passed |
| `pnpm build-storybook` | passed | passed |
| `pnpm audit --prod` | 54 advisories (3 critical, 28 high) | none |
| `pnpm e2e:web` | 48 passed, 9 skipped | 48 passed, 9 skipped |

`pnpm verify` runs lint, all three typechecks, the Jest suite, the relay suite
and the entrypoint checks in one command.

The web end-to-end suite includes the new
`e2e/specs/epub-security.spec.ts`; the 9 skips are the Electron-only specs,
as at the baseline. Electron end-to-end and packaged desktop builds were not
run; see "Release limitations".
