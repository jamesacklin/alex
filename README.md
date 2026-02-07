# Alex

[![CI:main](https://github.com/jamesacklin/book-app/actions/workflows/ci.yml/badge.svg)](https://github.com/jamesacklin/book-app/actions/workflows/ci.yml)
[![Docker Image](https://img.shields.io/badge/docker-jamesacklin%2Falex-blue?logo=docker)](https://hub.docker.com/r/jamesacklin/alex)
[![Docker Pulls](https://img.shields.io/docker/pulls/jamesacklin/alex)](https://hub.docker.com/r/jamesacklin/alex)

A self-hosted personal library for your ebook collection. Drop PDFs into a folder and Alex takes care of the rest — extracting metadata, generating covers, and making everything readable from a clean, fast web interface.

## Features

- **Zero-effort ingestion.** A background watcher monitors a folder on disk. Add a PDF or EPUB and it appears in your library automatically, complete with title, author, and a cover pulled from the first page.
- **Read in the browser.** Full-featured readers for both PDFs and EPUBs:
  - **PDF:** Page navigation, continuous zoom, fit-to-width rendering, and full-text search
  - **EPUB:** Table of contents navigation, chapter skipping, customizable font sizes (displayed in Times New Roman), and reflowable text that adapts to any screen
- **Reading progress.** Every page turn and location change is saved. Books move through *not started → reading → completed* on their own, and a progress bar on each card keeps your at-a-glance view honest.
- **Search and filter.** Find books by title or author. Filter by format and reading status, sort by what matters to you.
- **Multi-user.** Built-in user management with admin and user roles. Each reader keeps their own progress; admins can add or remove accounts.
- **Docker-ready.** Ships as a single container with everything it needs. Mount your book folder, set one secret, and it runs.

## Tech Stack

| Layer | What |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) with the App Router |
| Language | TypeScript |
| UI | React 19, [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) |
| Auth | [NextAuth.js v5](https://next-auth.aspen.finance) — credential-based, JWT sessions |
| Database | SQLite via [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team) |
| Book rendering | [PDF.js](https://mozilla.github.io/pdf.js/) (PDFs), [epub.js](https://github.com/futurepress/epub.js) via [react-reader](https://github.com/gerhardsletten/react-reader) (EPUBs), [pdf-parse](https://www.npmjs.com/package/pdf-parse) (metadata) |
| Cover generation | [poppler-utils](https://poppler.freedesktop.org/) (`pdftoppm`) with a [node-canvas](https://github.com/Automattic/node-canvas) synthetic fallback |
| File watching | [chokidar](https://github.com/paulmillr/chokidar) |

## Getting Started

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

   ⚠️ **Change the password immediately after logging in.**

5. **Add books:** Drop PDFs or EPUBs into your library folder (`/Volumes/books`). The file watcher will automatically detect and import them.

### Local Development

**One-command setup:**
```sh
pnpm setup          # installs deps, builds native modules, creates schema, seeds admin
```

**Or step-by-step:**
```sh
pnpm install
pnpm build:native   # builds better-sqlite3 for your Node.js version
pnpm db:push        # create the SQLite schema
pnpm db:seed        # seed the default admin user
```

In two terminals:

```sh
pnpm dev            # Next.js dev server → http://localhost:3000
pnpm watcher        # file watcher (watches ./data/library by default)
```

> **Note:** If you see errors about missing `better_sqlite3.node` bindings, run `pnpm build:native` to compile the native modules for your platform.

### Useful scripts

| Script | What it does |
|---|---|
| `pnpm setup` | Complete initial setup (install, build native deps, create schema, seed admin) |
| `pnpm build:native` | Build native dependencies (better-sqlite3, canvas) for your platform |
| `pnpm dev` | Next.js development server |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm watcher` | Background file watcher |
| `pnpm db:push` | Apply schema changes to the database |
| `pnpm db:seed` | Seed the default admin account |
| `pnpm db:reset` | Wipe the database and re-seed from scratch |
