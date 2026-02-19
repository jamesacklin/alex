# Alex

[![CI:main](https://github.com/jamesacklin/book-app/actions/workflows/ci.yml/badge.svg)](https://github.com/jamesacklin/book-app/actions/workflows/ci.yml)
[![Docker Image](https://img.shields.io/badge/docker-jamesacklin%2Falex-blue?logo=docker)](https://hub.docker.com/r/jamesacklin/alex)
[![Docker Pulls](https://img.shields.io/docker/pulls/jamesacklin/alex)](https://hub.docker.com/r/jamesacklin/alex)

A self-hosted personal library for your ebook collection. Drop PDFs or EPUBs into a folder and Alex takes care of the rest — extracting metadata, generating covers, and making everything readable from a clean, fast web interface.

## Features

- **Zero-effort ingestion.** A background watcher monitors a folder on disk. Add a PDF or EPUB and it appears in your library automatically, complete with title, author, and a cover pulled from the first page.
- **Read in the browser.** Full-featured readers for both PDFs and EPUBs, with a modern floating tab bar interface:
  - **PDF:** Page navigation, continuous zoom, fit-to-width rendering, and full-text search
  - **EPUB:** Table of contents navigation, chapter skipping, continuous vertical scrolling, customizable font sizes, an `80ch` reading column, and themed typography using IBM Plex Serif
- **Reading progress.** Every page turn and location change is saved. Books move through *not started → reading → completed* on their own. Progress appears on book cards and in the EPUB reader header with a precise percentage meter.
- **Now Reading sections.** Library and collection views each show a dedicated *Now Reading* shelf, powered by reading-progress status and recency. Books shown there are excluded from the corresponding *All Books* grids to avoid duplicates.
- **Public collections.** Share a collection with anyone via a link — no account required. Recipients can browse the book list and read PDFs and EPUBs directly in the browser. Share links use unguessable tokens and can be revoked at any time.
- **Search and filter.** Find books by title or author with pill-style filter UI. Filter by format and reading status, sort by what matters to you.
- **Multi-user.** Built-in user management with admin and user roles. Each reader keeps their own progress; admins can add or remove accounts.
- **Docker-ready.** Ships as a single container with everything it needs. Mount your book folder, set one secret, and it runs.

### Public Collections

Any collection can be shared by generating a share link from the collection detail page. The recipient sees a standalone page — outside the normal authenticated UI — where they can browse the collection and open any book in the full PDF or EPUB reader.

- **Token-based access.** Each shared collection gets a unique, unguessable UUID token. The public URL is `/shared/<token>`. Revoking sharing invalidates the token; re-sharing generates a new one.
- **Scoped endpoints.** Public API routes (`/api/shared/[token]/...`) serve collection metadata, cover images, and book files. Every request validates that the token is active and the book belongs to that collection — a valid token cannot be used to access books outside its collection.
- **Full reader, no account.** The public reader reuses the same `PdfReader` and `EpubReader` components as authenticated users. Reading progress for anonymous viewers is stored in the browser's `localStorage` rather than the server database.
- **No user data exposed.** Public responses omit the collection owner's identity. No anonymous user records are created on the server.

## Tech Stack

| Layer | What |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) with the App Router |
| Language | TypeScript (app), Rust (watcher + DB bridge) |
| UI | React 19, [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) |
| Auth | [NextAuth.js v5](https://next-auth.aspen.finance) — credential-based, JWT sessions |
| Database | SQLite via Rust (`watcher-rs` + `rusqlite`) |
| Book rendering | [PDF.js](https://mozilla.github.io/pdf.js/) (PDFs), [epub.js](https://github.com/futurepress/epub.js) via [react-reader](https://github.com/gerhardsletten/react-reader) (EPUBs) |
| Cover generation | Rust (`watcher-rs`) via [pdfium-render](https://crates.io/crates/pdfium-render) + fallback renderer |
| File watching | Rust (`watcher-rs`) via [`notify`](https://crates.io/crates/notify) |

## Getting Started

### Desktop App

Download the latest release for your platform from the [Releases page](https://github.com/jamesacklin/book-app/releases).

**Available platforms:**
- macOS (Apple Silicon)
- Windows (x64)
- Linux (AppImage, .deb)

#### Installation Notes

Since this app isn't signed with paid code-signing certificates, you may see security warnings on first launch:

**macOS:**
1. Download the `.zip` file
2. Extract it and drag Alex to your Applications folder
3. Right-click the app → **Open** (don't double-click)
4. Click **Open** in the security dialog
5. Subsequent launches work normally

**Windows:**
1. Download and run the `.exe` installer
2. Windows SmartScreen will show a warning
3. Click **More info** → **Run anyway**
4. Complete the installation
5. The warning only appears once

**Linux:**
- **AppImage:** Make executable (`chmod +x`) and run
- **.deb:** Install with `sudo dpkg -i alex*.deb`

### Docker Hub (quickest)

Pull and run the pre-built image:

```sh
docker pull jamesacklin/alex:latest
```

Create a `docker-compose.yml`:

```yaml
services:
  alex:
    image: jamesacklin/alex:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_PATH: /app/data/library.db
      LIBRARY_PATH: /app/data/library
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?Create a .env file and set NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-http://localhost:3000}
    volumes:
      - alex-data:/app/data
      - ./library:/app/data/library  # Change to your books folder
    restart: unless-stopped

volumes:
  alex-data:
```

Then follow steps 1, 3-5 from the "Docker (build from source)" section below.

### Docker (build from source)

1. Create a `.env` file in the project root:

```env
NEXTAUTH_SECRET=paste-a-random-string-here
```

Generate a random secret:
```sh
openssl rand -base64 32
```

2. **Point to your existing library.** Edit `docker-compose.yml` and change the library volume mount:

```yaml
volumes:
  - alex-data:/app/data
  # Change this line to point to your books folder:
  - /Volumes/books:/app/data/library
```

Or keep the default (`./library`) to create a new library folder next to your `docker-compose.yml`.

3. Start the stack:

```sh
docker compose up -d --build
```

4. Open [http://localhost:3000](http://localhost:3000). On first run, Alex creates a default admin account:
   - **Email:** `admin@localhost`
   - **Password:** `admin123`

   **Change the password immediately after logging in.**

5. **Add books:** Drop PDFs or EPUBs into your library folder (`/Volumes/books`). The file watcher will automatically detect and import them.

### Local Development

**One-command setup:**
```sh
pnpm setup          # installs deps, creates schema, seeds admin
```

**Or step-by-step:**
```sh
pnpm install
pnpm db:push        # create the SQLite schema (builds watcher-rs if needed)
pnpm db:seed        # seed the default admin user
```

In two terminals:

```sh
pnpm dev            # Next.js dev server → http://localhost:3000
pnpm watcher        # Rust watcher (watches ./data/library by default)
```

> **Rust toolchain required:** The watcher binary and database bridge are written in Rust. Install a stable toolchain with `rustup toolchain install stable`. The binary is built automatically by `pnpm db:push` and `pnpm watcher` if not already compiled.

### Electron Development

Use:

```sh
pnpm electron:dev
```

This runs Electron with the internal app-managed Next server on `http://localhost:3210`.

If you explicitly want an externally managed Next dev server, use:

```sh
pnpm electron:dev:external
```

### Useful scripts

| Script | What it does |
|---|---|
| `pnpm setup` | Complete initial setup (install, build watcher, create schema, seed admin) |
| `pnpm dev` | Next.js development server |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm watcher` | Rust file watcher (`watcher-rs`); builds the binary if not found |
| `pnpm watcher:build` | Build the `watcher-rs` release binary |
| `pnpm electron:dev` | Electron dev mode (app-managed server on `:3210`) |
| `pnpm electron:dev:external` | Electron dev with separately started Next dev server |
| `pnpm db:push` | Apply schema to the database (uses Rust bridge) |
| `pnpm db:seed` | Seed the default admin account |
| `pnpm db:reset` | Wipe the database and re-seed from scratch |
