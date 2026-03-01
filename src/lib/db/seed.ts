import bcrypt from "bcryptjs";
import { execute } from "./rust";

const ADMIN_EMAIL = "admin@localhost";
const ADMIN_PASSWORD = "admin123";
const ADMIN_ID = "1"; // Fixed ID for desktop mode compatibility

async function seed() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const now = Math.floor(Date.now() / 1000);

  const changes = await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(email) DO UPDATE SET
        password_hash = excluded.password_hash,
        display_name = excluded.display_name,
        role = excluded.role,
        updated_at = excluded.updated_at
    `,
    [ADMIN_ID, ADMIN_EMAIL, passwordHash, "Admin", "admin", now, now]
  );

  if (changes > 0) {
    console.log("Admin user upserted successfully.");
  } else {
    console.log("Admin user upsert completed with no changes.");
  }
}

seed();
