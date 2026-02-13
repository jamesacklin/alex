import { db } from "../src/lib/db";
import { users, readingProgress } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "admin@localhost";
const ADMIN_ID = "1";

async function fixAdminUserId() {
  console.log("Finding admin user...");

  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

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
  await db
    .update(readingProgress)
    .set({ userId: ADMIN_ID })
    .where(eq(readingProgress.userId, existingAdmin.id));

  console.log("Updated reading progress records.");

  // Delete the old admin user
  await db.delete(users).where(eq(users.id, existingAdmin.id));

  console.log("Deleted old admin user.");

  // Insert new admin user with ID '1'
  await db.insert(users).values({
    id: ADMIN_ID,
    email: existingAdmin.email,
    passwordHash: existingAdmin.passwordHash,
    displayName: existingAdmin.displayName,
    role: existingAdmin.role,
    createdAt: existingAdmin.createdAt,
    updatedAt: existingAdmin.updatedAt,
  });

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
