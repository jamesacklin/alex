/**
 * @jest-environment node
 */
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-"));
const dbFile = path.join(testDbDir, "users.db");
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
  role: "admin" | "user";
};

const adminUser: TestUser = {
  id: "admin-1",
  email: "admin@example.com",
  displayName: "Admin User",
  role: "admin",
};

const regularUser: TestUser = {
  id: "user-1",
  email: "user@example.com",
  displayName: "Regular User",
  role: "user",
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
  `);
}

function resetData() {
  sqlite.exec(`
    DELETE FROM users;
  `);

  const now = 1700000000;

  sqlite
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(adminUser.id, adminUser.email, "hashed", adminUser.displayName, adminUser.role, now, now);

  sqlite
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(regularUser.id, regularUser.email, "hashed", regularUser.displayName, regularUser.role, now + 1, now + 1);
}

beforeAll(() => {
  sqlite = new Database(dbFile);
  sqlite.pragma("foreign_keys = ON");
  initSchema(sqlite);
});

beforeEach(() => {
  resetData();
});

afterAll(() => {
  sqlite.close();
});

describe("Users API", () => {
  it("forbids non-admin users from listing users", async () => {
    authMock.mockResolvedValue({ user: regularUser });
    const { GET } = await import("@/app/api/users/route");

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lists users for admin", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { GET } = await import("@/app/api/users/route");

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users).toHaveLength(2);
    expect(body.users[0].id).toBe(adminUser.id);
  });

  it("creates a user with valid input", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { POST } = await import("@/app/api/users/route");

    const req = new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        displayName: "New User",
        password: "secret123",
        role: "user",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe("new@example.com");

    const count = sqlite
      .prepare("SELECT COUNT(*) as total FROM users WHERE email = ?")
      .get("new@example.com") as { total: number };
    expect(count.total).toBe(1);
  });

  it("rejects invalid user input", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { POST } = await import("@/app/api/users/route");

    const req = new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "",
        displayName: "No Password",
        password: "",
        role: "user",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects duplicate emails", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { POST } = await import("@/app/api/users/route");

    const req = new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminUser.email,
        displayName: "Dup",
        password: "secret123",
        role: "user",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("prevents admin from deleting self", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { DELETE } = await import("@/app/api/users/[id]/route");

    const res = await DELETE(new Request("http://localhost/api/users/admin-1"), {
      params: Promise.resolve({ id: adminUser.id }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when deleting missing user", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { DELETE } = await import("@/app/api/users/[id]/route");

    const res = await DELETE(new Request("http://localhost/api/users/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes a user", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    const { DELETE } = await import("@/app/api/users/[id]/route");

    const res = await DELETE(new Request("http://localhost/api/users/user-1"), {
      params: Promise.resolve({ id: regularUser.id }),
    });
    expect(res.status).toBe(200);

    const remaining = sqlite
      .prepare("SELECT COUNT(*) as total FROM users WHERE id = ?")
      .get(regularUser.id) as { total: number };
    expect(remaining.total).toBe(0);
  });
});
