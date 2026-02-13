import bcrypt from "bcryptjs";
import { db } from "./index";
import { users } from "./schema";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "admin@localhost";
const ADMIN_PASSWORD = "admin123";
const ADMIN_ID = "1"; // Fixed ID for desktop mode compatibility

async function seed() {
  const existing = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);

  if (existing.length > 0) {
    console.log("Admin user already exists, skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const now = Math.floor(Date.now() / 1000);

  await db.insert(users).values({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    passwordHash,
    displayName: "Admin",
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });

  console.log("Admin user created successfully.");
}

seed();
