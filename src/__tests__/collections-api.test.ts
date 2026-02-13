/**
 * @jest-environment node
 */
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-"));
const dbFile = path.join(testDbDir, "collections.db");
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

const book = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  fileType: "epub",
  filePath: "/tmp/test.epub",
  fileSize: 1234,
  fileHash: "hash",
  addedAt: 1700000000,
  updatedAt: 1700000000,
};

let sqlite: Database.Database;

function initSchema(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

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
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      share_token TEXT UNIQUE,
      shared_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_books (
      collection_id TEXT NOT NULL REFERENCES collections(id),
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (collection_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      user_id TEXT NOT NULL REFERENCES users(id),
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'not_started',
      current_page INTEGER,
      total_pages INTEGER,
      epub_location TEXT,
      percent_complete REAL NOT NULL DEFAULT 0,
      last_read_at INTEGER,
      PRIMARY KEY (user_id, book_id)
    );
  `);
}

function resetData() {
  sqlite.exec(`
    DELETE FROM reading_progress;
    DELETE FROM collection_books;
    DELETE FROM collections;
    DELETE FROM books;
    DELETE FROM users;
  `);

  const now = 1700000000;

  sqlite
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(user.id, user.email, "hashed", user.displayName, user.role, now, now);

  sqlite
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(otherUser.id, otherUser.email, "hashed", otherUser.displayName, otherUser.role, now, now);

  sqlite
    .prepare(
      `INSERT INTO books (id, title, author, file_type, file_path, file_size, file_hash, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      book.id,
      book.title,
      book.author,
      book.fileType,
      book.filePath,
      book.fileSize,
      book.fileHash,
      book.addedAt,
      book.updatedAt,
    );
}

beforeAll(() => {
  sqlite = new Database(dbFile);
  sqlite.pragma("foreign_keys = ON");
  initSchema(sqlite);
});

beforeEach(() => {
  resetData();
  authMock.mockResolvedValue({ user });
});

afterAll(() => {
  sqlite.close();
});

describe("Collections API", () => {
  it("creates and lists collections", async () => {
    const { POST, GET } = await import("@/app/api/collections/route");

    const createReq = new Request("http://localhost/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sci-Fi", description: "Space reads" }),
    });

    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe("Sci-Fi");

    const listRes = await GET(new Request("http://localhost/api/collections"));
    const list = await listRes.json();
    expect(Array.isArray(list.collections)).toBe(true);
    expect(list.collections).toHaveLength(1);
    expect(list.collections[0].bookCount).toBe(0);
  });

  it("returns collection with its books", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");

    sqlite
      .prepare("INSERT INTO collections (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("col-1", user.id, "Favorites", "Best of", 1700000000);
    sqlite
      .prepare("INSERT INTO collection_books (collection_id, book_id, added_at) VALUES (?, ?, ?)")
      .run("col-1", book.id, 1700000000);

    const res = await GET(new Request("http://localhost/api/collections/col-1"), {
      params: Promise.resolve({ id: "col-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collection.id).toBe("col-1");
    expect(body.books).toHaveLength(1);
    expect(body.books[0].id).toBe(book.id);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it("updates and deletes a collection", async () => {
    const { PUT, DELETE } = await import("@/app/api/collections/[id]/route");

    sqlite
      .prepare("INSERT INTO collections (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("col-2", user.id, "Old", null, 1700000000);

    const updateReq = new Request("http://localhost/api/collections/col-2", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", description: "New desc" }),
    });

    const updateRes = await PUT(updateReq, { params: Promise.resolve({ id: "col-2" }) });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.name).toBe("Updated");

    const deleteRes = await DELETE(new Request("http://localhost/api/collections/col-2"), {
      params: Promise.resolve({ id: "col-2" }),
    });
    expect(deleteRes.status).toBe(200);

    const remaining = sqlite
      .prepare("SELECT COUNT(*) as total FROM collections WHERE id = ?")
      .get("col-2") as { total: number };
    expect(remaining.total).toBe(0);
  });

  it("adds and removes a book from a collection", async () => {
    const { POST } = await import("@/app/api/collections/[id]/books/route");
    const { DELETE } = await import("@/app/api/collections/[id]/books/[bookId]/route");

    sqlite
      .prepare("INSERT INTO collections (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("col-3", user.id, "Queue", null, 1700000000);

    const addReq = new Request("http://localhost/api/collections/col-3/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id }),
    });

    const addRes = await POST(addReq, { params: Promise.resolve({ id: "col-3" }) });
    expect(addRes.status).toBe(201);

    const removeRes = await DELETE(new Request("http://localhost/api/collections/col-3/books/book-1"), {
      params: Promise.resolve({ id: "col-3", bookId: book.id }),
    });
    expect(removeRes.status).toBe(200);

    const remaining = sqlite
      .prepare("SELECT COUNT(*) as total FROM collection_books WHERE collection_id = ?")
      .get("col-3") as { total: number };
    expect(remaining.total).toBe(0);
  });

  it("returns 404 for collections owned by another user", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");

    sqlite
      .prepare("INSERT INTO collections (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("col-4", otherUser.id, "Private", null, 1700000000);

    const res = await GET(new Request("http://localhost/api/collections/col-4"), {
      params: Promise.resolve({ id: "col-4" }),
    });

    expect(res.status).toBe(404);
  });
});
