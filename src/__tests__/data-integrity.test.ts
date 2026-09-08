/**
 * @jest-environment node
 *
 * Regressions for F12 (database constraints and mutations disagree).
 *
 * Both cases the review reproduced are covered: concurrent first progress
 * saves creating duplicate rows for one (user, book) pair, and
 * `DELETE FROM users` failing with `FOREIGN KEY constraint failed` for any
 * account that has actually been used.
 */
import { createTestDatabase } from "./helpers/test-db";

const testDb = createTestDatabase("data-integrity");

import { execute, queryAll, queryOne } from "@/lib/db/rust";

const authMock = jest.fn();
jest.mock("@/lib/auth/config", () => ({
  authSession: () => authMock(),
  auth: () => authMock(),
}));

const NOW = 1_700_000_000;

const reader = { id: "reader-1", email: "reader@example.com", displayName: "Reader", role: "user" };
const admin = { id: "admin-1", email: "admin@example.com", displayName: "Admin", role: "admin" };

async function insertUser(user: typeof reader) {
  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role,
        session_version, created_at, updated_at
      )
      VALUES (?1, ?2, 'hashed', ?3, ?4, 1, ?5, ?5)
    `,
    [user.id, user.email, user.displayName, user.role, NOW]
  );
}

async function insertBook(id: string, fileType: "epub" | "pdf") {
  await execute(
    `
      INSERT INTO books (
        id, title, file_type, file_path, file_size, file_hash, page_count, added_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, 100, ?5, 10, ?6, ?6)
    `,
    [id, `Book ${id}`, fileType, `/library/${id}.${fileType}`, `hash-${id}`, NOW]
  );
}

async function progressRowsFor(userId: string, bookId: string) {
  return queryAll<{ id: string; percentComplete: number }>(
    `
      SELECT id, percent_complete AS percentComplete
      FROM reading_progress
      WHERE user_id = ?1 AND book_id = ?2
    `,
    [userId, bookId]
  );
}

beforeAll(async () => {
  await testDb.migrate();
});

beforeEach(async () => {
  await testDb.truncate();
  authMock.mockReset();
});

afterAll(() => {
  testDb.cleanup();
});

describe("F12 — one progress row per (user, book)", () => {
  it("leaves exactly one row after 20 concurrent first saves", async () => {
    await insertUser(reader);
    await insertBook("book-epub", "epub");
    authMock.mockResolvedValue({ user: reader });

    const { PUT } = await import("@/app/api/books/[id]/progress/route");
    const params = Promise.resolve({ id: "book-epub" });

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        PUT(
          new Request("http://localhost/api/books/book-epub/progress", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              epubLocation: `epubcfi(/6/${index}!/4/2)`,
              percentComplete: index + 1,
            }),
          }),
          { params }
        )
      )
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const rows = await progressRowsFor(reader.id, "book-epub");
    expect(rows).toHaveLength(1);
  });

  it("leaves exactly one row after concurrent first PDF saves", async () => {
    await insertUser(reader);
    await insertBook("book-pdf", "pdf");
    authMock.mockResolvedValue({ user: reader });

    const { PUT } = await import("@/app/api/books/[id]/progress/route");
    const params = Promise.resolve({ id: "book-pdf" });

    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        PUT(
          new Request("http://localhost/api/books/book-pdf/progress", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ currentPage: index + 1, totalPages: 100 }),
          }),
          { params }
        )
      )
    );

    expect(await progressRowsFor(reader.id, "book-pdf")).toHaveLength(1);
  });

  it("rejects a duplicate pair at the schema level", async () => {
    await insertUser(reader);
    await insertBook("book-epub", "epub");

    await execute(
      `
        INSERT INTO reading_progress (id, user_id, book_id, percent_complete, status, last_read_at)
        VALUES ('p1', ?1, 'book-epub', 10, 'reading', ?2)
      `,
      [reader.id, NOW]
    );

    await expect(
      execute(
        `
          INSERT INTO reading_progress (id, user_id, book_id, percent_complete, status, last_read_at)
          VALUES ('p2', ?1, 'book-epub', 20, 'reading', ?2)
        `,
        [reader.id, NOW]
      )
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("keeps a book listed once when progress exists", async () => {
    await insertUser(reader);
    await insertBook("book-epub", "epub");
    authMock.mockResolvedValue({ user: reader });

    const { PUT } = await import("@/app/api/books/[id]/progress/route");
    await PUT(
      new Request("http://localhost/api/books/book-epub/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ epubLocation: "epubcfi(/6/2!/4/2)", percentComplete: 25 }),
      }),
      { params: Promise.resolve({ id: "book-epub" }) }
    );

    const joined = await queryAll<{ id: string }>(
      `
        SELECT b.id
        FROM books b
        LEFT JOIN reading_progress rp
          ON rp.book_id = b.id AND rp.user_id = ?1
      `,
      [reader.id]
    );
    expect(joined).toHaveLength(1);
  });
});

describe("F12 — deleting an account that has been used", () => {
  async function seedUsedAccount() {
    await insertUser(admin);
    await insertUser(reader);
    await insertBook("book-epub", "epub");

    await execute(
      `
        INSERT INTO reading_progress (id, user_id, book_id, percent_complete, status, last_read_at)
        VALUES ('p1', ?1, 'book-epub', 40, 'reading', ?2)
      `,
      [reader.id, NOW]
    );
    await execute(
      `
        INSERT INTO collections (id, user_id, name, created_at)
        VALUES ('c1', ?1, 'Reader Shelf', ?2)
      `,
      [reader.id, NOW]
    );
    await execute(
      `
        INSERT INTO collection_books (collection_id, book_id, added_at)
        VALUES ('c1', 'book-epub', ?1)
      `,
      [NOW]
    );
  }

  it("shows why the bare DELETE could not work", async () => {
    await seedUsedAccount();

    // The original implementation issued exactly this statement; SQLite runs
    // with PRAGMA foreign_keys=ON and reading_progress/collections reference
    // users with ON DELETE NO ACTION.
    await expect(
      execute("DELETE FROM users WHERE id = ?1", [reader.id])
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("removes the account and its dependent state through the primitive", async () => {
    await seedUsedAccount();

    const { deleteAccount } = await import("@/lib/db/accounts");
    const result = await deleteAccount(reader.id);

    expect(result).toMatchObject({
      deleted: true,
      removedProgress: 1,
      removedCollections: 1,
      removedCollectionBooks: 1,
    });

    expect(await queryOne("SELECT id FROM users WHERE id = ?1", [reader.id])).toBeNull();
    expect(
      await queryOne("SELECT id FROM reading_progress WHERE user_id = ?1", [reader.id])
    ).toBeNull();
    expect(
      await queryOne("SELECT id FROM collections WHERE user_id = ?1", [reader.id])
    ).toBeNull();

    // Library content is shared and must survive deleting a reader.
    expect(await queryOne("SELECT id FROM books WHERE id = 'book-epub'")).not.toBeNull();
  });

  it("reports a missing account without deleting anything", async () => {
    await seedUsedAccount();

    const { deleteAccount } = await import("@/lib/db/accounts");
    expect(await deleteAccount("no-such-user")).toMatchObject({ deleted: false });
    expect(await queryOne("SELECT id FROM users WHERE id = ?1", [reader.id])).not.toBeNull();
  });

  it("rolls the whole batch back when one statement fails", async () => {
    const { transaction } = await import("@/lib/db/rust");
    await insertUser(reader);

    await expect(
      transaction([
        { sql: "DELETE FROM users WHERE id = ?1", params: [reader.id] },
        { sql: "THIS IS NOT SQL" },
      ])
    ).rejects.toThrow();

    // The first statement must not have survived the failure.
    expect(await queryOne("SELECT id FROM users WHERE id = ?1", [reader.id])).not.toBeNull();
  });

  it("returns per-statement results in order", async () => {
    const { transaction } = await import("@/lib/db/rust");

    const results = await transaction([
      {
        sql: `
          INSERT INTO users (id, email, password_hash, display_name, role, session_version, created_at, updated_at)
          VALUES ('t1', 't1@example.com', 'h', 'T1', 'user', 1, ?1, ?1)
        `,
        params: [NOW],
      },
      { sql: "SELECT id FROM users WHERE id = 't1'", mode: "query-one" },
      { sql: "SELECT id FROM users", mode: "query-all" },
    ]);

    expect(results[0]).toEqual({ changes: 1 });
    expect(results[1]).toEqual({ row: { id: "t1" } });
    expect(results[2]).toEqual({ rows: [{ id: "t1" }] });
  });
});
