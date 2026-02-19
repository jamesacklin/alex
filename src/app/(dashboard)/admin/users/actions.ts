"use server";

import bcrypt from "bcryptjs";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";

export async function createUser(data: {
  email: string;
  displayName: string;
  password: string;
  role: string;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE email = ?1
      LIMIT 1
    `,
    [data.email]
  );
  if (existing) {
    return { error: "Email already in use" };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const now = Math.floor(Date.now() / 1000);

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [crypto.randomUUID(), data.email, passwordHash, data.displayName, data.role, now, now]
  );

  return { success: true };
}

export async function deleteUser(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  if (session.user.id === id) {
    return { error: "Cannot delete your own account" };
  }

  await execute("DELETE FROM users WHERE id = ?1", [id]);

  return { success: true };
}

export async function updateUser(
  id: string,
  data: { displayName: string; role: string },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  if (!data.displayName?.trim()) {
    return { error: "Display name is required" };
  }

  if (!["admin", "user"].includes(data.role)) {
    return { error: "Role must be admin or user" };
  }

  if (session.user.id === id && data.role !== "admin") {
    return { error: "Cannot remove your own admin role" };
  }

  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE id = ?1
      LIMIT 1
    `,
    [id]
  );
  if (!existing) {
    return { error: "User not found" };
  }

  await execute(
    `
      UPDATE users
      SET display_name = ?1,
          role = ?2,
          updated_at = ?3
      WHERE id = ?4
    `,
    [data.displayName.trim(), data.role, Math.floor(Date.now() / 1000), id]
  );

  return { success: true };
}
