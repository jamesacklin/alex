/**
 * @jest-environment node
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execute } from "@/lib/db/rust";

const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-"));
const dbFile = path.join(testDbDir, "books.db");
process.env.DATABASE_PATH = dbFile;

const authMock = jest.fn();

jest.mock("@/lib/auth/config", () => ({
  authSession: () => authMock(),
  auth: () => authMock(),
}));

type TestUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

const user: TestUser = {
  id: "user-1",
  email: "user@example.com",
  displayName: "Test User",
  role: "user",
};

const otherUser: TestUser = {
  id: "user-2",
  email: "other@example.com",
  displayName: "Other User",
  role: "user",
};

const books = [
  {
    id: "book-1",
    title: "Alpha Book",
    author: "Author A",
    fileType: "epub",
    filePath: "/tmp/alpha.epub",
    fileSize: 1234,
    fileHash: "hash-a",
    addedAt: 1700000001,
    updatedAt: 1700000001,
  },
  {
    id: "book-2",
    title: "Beta Book",
    author: "Author B",
    fileType: "pdf",
    filePath: "/tmp/beta.pdf",
    fileSize: 5678,
    fileHash: "hash-b",
    addedAt: 1700000002,
    updatedAt: 1700000002,
  },
];

async function initSchema() {
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      description TEXT,
      file_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      cover_path TEXT,
      page_count INTEGER,
      added_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      current_page INTEGER NOT NULL DEFAULT 0,
      total_pages INTEGER,
      epub_location TEXT,
      percent_complete REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_started',
      last_read_at INTEGER
    )
  `);
}

async function resetData() {
  await execute("DELETE FROM reading_progress");
  await execute("DELETE FROM books");
  await execute("DELETE FROM users");

  const now = 1700000000;

  await execute(
    `
      INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [user.id, user.email, "hashed", user.displayName, user.role, now, now]
  );

  await execute(
    `
      INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [otherUser.id, otherUser.email, "hashed", otherUser.displayName, otherUser.role, now, now]
  );

  for (const book of books) {
    await execute(
      `
        INSERT INTO books (id, title, author, file_type, file_path, file_size, file_hash, added_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `,
      [
        book.id,
        book.title,
        book.author,
        book.fileType,
        book.filePath,
        book.fileSize,
        book.fileHash,
        book.addedAt,
        book.updatedAt,
      ]
    );
  }

  await execute(
    `
      INSERT INTO reading_progress (id, user_id, book_id, current_page, total_pages, percent_complete, status, last_read_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `,
    ["rp-1", user.id, "book-1", 5, 100, 0.05, "reading", 1700000100]
  );

  await execute(
    `
      INSERT INTO reading_progress (id, user_id, book_id, current_page, total_pages, percent_complete, status, last_read_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `,
    ["rp-2", otherUser.id, "book-2", 10, 200, 0.1, "reading", 1700000200]
  );
}

beforeAll(async () => {
  await initSchema();
});

beforeEach(async () => {
  await resetData();
  authMock.mockResolvedValue({ user });
});

afterAll(() => {
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("Books API", () => {
  it("lists books with reading progress for the current user", async () => {
    const { GET } = await import("@/app/api/books/route");

    const res = await GET(new Request("http://localhost/api/books"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.books).toHaveLength(2);

    const first = body.books[0];
    expect(first.id).toBe("book-2");
    expect(first.readingProgress).toBeNull();

    const second = body.books[1];
    expect(second.id).toBe("book-1");
    expect(second.readingProgress).not.toBeNull();
    expect(second.readingProgress.status).toBe("reading");
  });

  it("returns a single book with reading progress", async () => {
    const { GET } = await import("@/app/api/books/[id]/route");

    const res = await GET(new Request("http://localhost/api/books/book-1"), {
      params: Promise.resolve({ id: "book-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("book-1");
    expect(body.readingProgress).not.toBeNull();
    expect(body.readingProgress.currentPage).toBe(5);
  });

  it("returns 404 for unknown books", async () => {
    const { GET } = await import("@/app/api/books/[id]/route");

    const res = await GET(new Request("http://localhost/api/books/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(res.status).toBe(404);
  });
});

