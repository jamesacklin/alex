"use server";

import bcrypt from "bcryptjs";
import { execute, queryOne } from "@/lib/db/rust";

export async function createAdmin(data: {
  email: string;
  displayName: string;
  password: string;
}) {
  // Guard: ensure no users exist (prevents race on concurrent requests)
  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      LIMIT 1
    `
  );
  if (existing) {
    return { error: "Setup already completed" };
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
    [crypto.randomUUID(), data.email, passwordHash, data.displayName, "admin", now, now]
  );

  return { success: true };
}
