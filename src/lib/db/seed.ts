import bcrypt from "bcryptjs";
import { execute, queryOne } from "./rust";

const ADMIN_EMAIL = "admin@localhost";
const ADMIN_PASSWORD = "admin123";
const ADMIN_ID = "1"; // Fixed ID for desktop mode compatibility

async function seed() {
  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE email = ?1
      LIMIT 1
    `,
    [ADMIN_EMAIL]
  );

  if (existing) {
    console.log("Admin user already exists, skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const now = Math.floor(Date.now() / 1000);

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [ADMIN_ID, ADMIN_EMAIL, passwordHash, "Admin", "admin", now, now]
  );

  console.log("Admin user created successfully.");
}

seed();
