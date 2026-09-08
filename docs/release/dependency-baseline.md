# Dependency baseline

Established as part of the September 2026 adversarial review remediation
(finding F11's dependency half). Re-run the audits below before each release
and update the disposition table.

## Method

```sh
pnpm install --frozen-lockfile
pnpm audit --prod     # gated in CI: a hit fails the build
pnpm audit            # informational: includes build and test tooling
```

`pnpm` is the declared package manager (`packageManager` in `package.json`),
so the audit runs against the same resolution the lockfile produces. Advisory
severities and "patched in" ranges below are the scanner's, cross-checked
against the maintainer advisory where the two disagreed.

## Shipped-runtime inventory

These are the components that end up in front of a user, and therefore the
ones whose advisories matter most. Note that `pnpm audit --prod` alone does
**not** cover all of them: Electron is a `devDependency` even though it *is*
the desktop runtime, and neither Rust crates nor PDFium appear at all.

| Component | Version | How it is audited |
| --- | --- | --- |
| Next.js | 16.3.4 | `pnpm audit --prod` |
| Auth.js (`next-auth` / `@auth/core`) | 5.0.0-beta.32 / 0.41.3 | `pnpm audit --prod` |
| React / React DOM | 19.2.8 | `pnpm audit --prod` |
| epubjs | 0.3.93 (+ overrides) | `pnpm audit --prod` |
| pdfjs-dist / react-pdf | 5.4.296 / 10.x | `pnpm audit --prod` |
| Electron (desktop runtime) | 39.8.10 | `pnpm audit` — **dev dependency, shipped runtime** |
| electron-builder | 26.15.3 | `pnpm audit` |
| Rust crates (`watcher-rs`) | see `watcher-rs/Cargo.lock` | `cargo audit` — **not yet wired into CI** |
| PDFium | fetched by `pdfium-render`'s build script | **no automated audit** |

## Changes made

| Change | Reason |
| --- | --- |
| `next` 16.1.6 → 16.3.4 | Clears GHSA-26hh-7cqf-hhc6 (App Router middleware/proxy bypass via segment-prefetch, fixed 16.2.6) plus the 16.2.5 and 16.2.11 advisory batches: further middleware bypasses, SSRF in Server Actions and rewrites, and several Server Components denial-of-service issues. |
| `next-auth` 5.0.0-beta.30 → 5.0.0-beta.32 | Clears GHSA-8fpg-xm3f-6cx3 (a configuration error populates the auth object, so existence-based checks fail open), GHSA-7rqj-j65f-68wh (homoglyph `@` bypass in the email normalizer) and GHSA-xmf8-cvqr-rfgj (uncaught exception on a malformed Bearer header). The scanner and the maintainer disagreed on severity for the first — critical vs low — but agreed on beta.32 as the fix. Note the *code-level* mitigation for that advisory is independent of the upgrade: middleware and `authSession()` now require a concrete `user.id` and fail closed (F11). |
| `electron` 34.5.8 → 39.8.10 | Electron 34 is out of support. 39.8.10 is the lowest version clearing all six advisories that applied to 34.5.8 (GHSA-532v-xpq5-8h95, GHSA-8337-3p73-46f4, GHSA-jjp3-mq3x-295m, GHSA-9wfr-w7mm-pc7f, GHSA-v3j7-r9gq-3gjw, GHSA-h7rp-cf8h-j98x, GHSA-9f4c-93c8-jc8g) and is on a supported line. Required one source change: `app.dock` is typed as possibly undefined from Electron 36 onward. |
| `electron-builder` 25.1.8 → 26.15.3 | Compatibility with Electron 39, plus GHSA-7g7r-gx96-252g (`app-builder-lib`) and GHSA-p2f4-r6v6-j797 (`builder-util-runtime`). |
| `react`/`react-dom` pinned to 19.2.8 (root and override) | The root pinned 19.2.3 while the `@alex/ui` workspace peer resolved 19.2.8, producing two copies of `react-hook-form` whose structurally identical types are nominally incompatible at every `<Form>` boundary. |
| `pnpm` overrides for `epubjs>lodash`, `epubjs>@xmldom/xmldom`, `postcss>nanoid`, `browserslist`, `miniflare>undici` | Transitive advisories the direct dependency ranges cannot reach. Each override is scoped to the dependent that pulls the vulnerable copy so a future consumer wanting a different major is not pinned back. |

## Reachability triage

Recorded because "54 scanner matches" is not "54 exploitable paths", and
because a couple of these are genuinely unreachable in Alex's configuration.

| Advisory | Reachable here? | Disposition |
| --- | --- | --- |
| GHSA-8fpg-xm3f-6cx3 (Auth.js fails open on config error) | **Yes.** `src/middleware.ts` used `!!session`, and the truthy error object satisfied it. | Fixed twice over: upgraded to beta.32 *and* changed the application decision to require a concrete `user.id`. Regression: `src/__tests__/auth-boundaries.test.ts`, "F11 — an auth-error object is not an identity". |
| GHSA-26hh-7cqf-hhc6 (Next middleware/proxy bypass) | **Yes.** Middleware is the routing gate for `/admin` and the API surface. | Fixed by the upgrade. Note that middleware is no longer the *authorization* boundary either — `authSession()` revalidates against the database — so a future bypass of the same class is less consequential. |
| GHSA-7rqj-j65f-68wh (Auth.js email homoglyph bypass) | **No.** The advisory concerns the email provider's normalizer; Alex is credentials-only and has no email provider configured. | Fixed by the upgrade regardless. |
| Electron advisories on 34.5.8 | **Yes.** Electron is the desktop runtime, and it renders untrusted book content. | Fixed by the upgrade to 39.8.10. |
| `epubjs>@xmldom/xmldom` (5 XML injection / DoS advisories) | **No.** epubjs only falls back to xmldom when the native `DOMParser`/`XMLSerializer` is undefined (`lib/utils/core.js`, `lib/section.js`), i.e. under Node or IE. `EpubReader` is imported with `ssr: false`, so parsing always uses the browser's native implementation. | Overridden to `^0.8.15` anyway: the module is bundled into the client build, and the override costs nothing. |
| `epubjs>lodash` (GHSA-r5fr-rjxr-66jc, `_.template` code injection) | **No.** epubjs does not use `_.template`. | Overridden to `^4.18.1`. |
| `postcss>nanoid`, `browserslist` | **No.** Build-time only; they process this project's own CSS and config, not untrusted input. | Overridden anyway (cheap, no API change). |
| `miniflare>undici` (5 advisories) | **No.** Only in the relay's Workers *test* runtime. | Overridden to `^7.29.0`. |
| `electron>extract-zip` (GHSA-jmr9-qjv8-65gv, symlink path traversal) | **No.** Runs at `pnpm install` time, unpacking the Electron download from Electron's own CDN over TLS. | **Waived, no fix available** (`patched_versions: <0.0.0`). Revisit when Electron switches unpackers. |
| `@storybook/nextjs > … > elliptic` (GHSA-848j-6mx2-7j84, low) | **No.** Inside a webpack node-polyfill bundle used only by the Storybook build; not shipped by Alex. | **Waived, no fix available.** |

## Current state

```
pnpm audit --prod   →  no known vulnerabilities
pnpm audit          →  2 advisories, both waived above with no upstream fix
```

Down from 54 production matches (3 critical, 28 high, 19 moderate, 4 low) and
159 total at the reviewed commit.

## Gaps

These are stated rather than quietly omitted.

- **`cargo audit` is not in CI.** The Rust dependency set is pinned by
  `watcher-rs/Cargo.lock` and was not changed by this work beyond enabling two
  additional `tokio` features (`io-std`, `io-util`), which left the lockfile
  untouched. Adding a `cargo audit`/`cargo deny` gate is a follow-up.
- **PDFium has no automated audit.** It is downloaded by `pdfium-render`'s
  build script from a pinned release. Tracking its advisories needs a manual
  process or a vendored, checksummed artifact.
- **Desktop packages were not built or smoke-tested for this baseline.** The
  Electron and electron-builder upgrades type-check (`pnpm typecheck:electron`)
  and the standalone bundle builds, but `electron-builder --mac/--win/--linux`
  and a packaged-app launch were not run. That is an explicit release
  limitation: see docs/release/adversarial-review-remediation.md.
