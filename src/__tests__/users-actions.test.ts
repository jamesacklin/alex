/**
 * @jest-environment node
 */
import fs from "fs";
import os from "os";
import path from "path";
import bcrypt from "bcryptjs";
import { execute, queryOne } from "@/lib/db/rust";

const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-"));
const dbFile = path.join(testDbDir, "users-actions.db");
process.env.DATABASE_PATH = dbFile;

const authMock = jest.fn();

jest.mock("@/lib/auth/config", () => ({
  authSession: () => authMock(),
  auth: () => authMock(),
}));

beforeAll(async () => {
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
});

beforeEach(async () => {
  await execute("DELETE FROM users");
  const now = Math.floor(Date.now() / 1000);

  await execute(
    `
      INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    ["admin-1", "admin@example.com", "hashed-admin", "Admin", "admin", now, now]
  );

  await execute(
    `
      INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    ["user-1", "user@example.com", "hashed-user", "User", "user", now, now]
  );
});

afterAll(() => {
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("User actions", () => {
  it("forbids non-admin users from changing passwords", async () => {
    authMock.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "user" },
    });

    const { updateUserPassword } = await import("@/app/(dashboard)/admin/users/actions");
    const result = await updateUserPassword("admin-1", { password: "newpassword123" });

    expect(result).toEqual({ error: "Forbidden" });
  });

  it("rejects too-short passwords", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", role: "admin" },
    });

    const { updateUserPassword } = await import("@/app/(dashboard)/admin/users/actions");
    const result = await updateUserPassword("user-1", { password: "12345" });

    expect(result).toEqual({ error: "Password must be at least 6 characters" });
  });

  it("updates password hash for an existing user", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", role: "admin" },
    });

    const { updateUserPassword } = await import("@/app/(dashboard)/admin/users/actions");
    const result = await updateUserPassword("user-1", { password: "newpassword123" });

    expect(result).toEqual({ success: true });

    const updated = await queryOne<{ passwordHash: string }>(
      `
        SELECT password_hash AS passwordHash
        FROM users
        WHERE id = ?1
        LIMIT 1
      `,
      ["user-1"]
    );

    expect(updated?.passwordHash).toBeTruthy();
    expect(updated?.passwordHash).not.toBe("hashed-user");
    expect(await bcrypt.compare("newpassword123", String(updated?.passwordHash))).toBe(true);
  });
});
