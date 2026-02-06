# Alex

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

### Docker (recommended)

1. Create a `.env` file in the project root:

```env
NEXTAUTH_SECRET=paste-a-random-string-here
```

2. Create a `library` folder (or point to an existing one — see `docker-compose.yml`).

3. Start the stack:

```sh
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). On first run, Alex creates a default admin account (`admin@localhost` / `admin123`). Change the password after you log in.

### Local Development

```sh
pnpm install
pnpm db:push        # create the SQLite schema
pnpm db:seed        # seed the default admin user
```

In two terminals:

```sh
pnpm dev            # Next.js dev server → http://localhost:3000
pnpm watcher        # file watcher (watches ./data/library by default)
```

### Useful scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next.js development server |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm watcher` | Background file watcher |
| `pnpm db:push` | Apply schema changes to the database |
| `pnpm db:seed` | Seed the default admin account |
| `pnpm db:reset` | Wipe the database and re-seed from scratch |
