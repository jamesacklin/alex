import { execute, queryOne } from "../src/lib/db/rust";

const ADMIN_EMAIL = "admin@localhost";
const ADMIN_ID = "1";

async function fixAdminUserId() {
  console.log("Finding admin user...");

  const existingAdmin = await queryOne<{
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: string;
    createdAt: number;
    updatedAt: number;
  }>(
    `
      SELECT
        id,
        email,
        password_hash AS passwordHash,
        display_name AS displayName,
        role,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM users
      WHERE email = ?1
      LIMIT 1
    `,
    [ADMIN_EMAIL]
  );

  if (!existingAdmin) {
    console.log("No admin user found, nothing to fix.");
    return;
  }

  if (existingAdmin.id === ADMIN_ID) {
    console.log("Admin user already has correct ID.");
    return;
  }

  console.log(`Updating admin user ID from ${existingAdmin.id} to ${ADMIN_ID}...`);

  // Update reading progress to point to new user ID
  await execute(
    `
      UPDATE reading_progress
      SET user_id = ?1
      WHERE user_id = ?2
    `,
    [ADMIN_ID, existingAdmin.id]
  );

  console.log("Updated reading progress records.");

  // Delete the old admin user
  await execute("DELETE FROM users WHERE id = ?1", [existingAdmin.id]);

  console.log("Deleted old admin user.");

  // Insert new admin user with ID '1'
  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [
      ADMIN_ID,
      existingAdmin.email,
      existingAdmin.passwordHash,
      existingAdmin.displayName,
      existingAdmin.role,
      existingAdmin.createdAt,
      existingAdmin.updatedAt,
    ]
  );

  console.log(`Admin user recreated with ID ${ADMIN_ID}.`);
  console.log("Done!");
}

fixAdminUserId()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
