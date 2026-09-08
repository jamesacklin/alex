/**
 * @jest-environment node
 */
import bcrypt from "bcryptjs";
import { createTestDatabase } from "./helpers/test-db";

const testDb = createTestDatabase("users-actions");

import { execute, queryOne } from "@/lib/db/rust";

const authMock = jest.fn();

jest.mock("@/lib/auth/config", () => ({
  authSession: () => authMock(),
  auth: () => authMock(),
}));

beforeAll(async () => {
  await testDb.migrate();
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
  testDb.cleanup();
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

    expect(result).toEqual({ error: "Password must be at least 8 characters" });
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
