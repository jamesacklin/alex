"use server";

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function createAdmin(data: {
  email: string;
  displayName: string;
  password: string;
}) {
  // Guard: ensure no users exist (prevents race on concurrent requests)
  const [existing] = await db.select().from(users).limit(1);
  if (existing) {
    return { error: "Setup already completed" };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const now = Math.floor(Date.now() / 1000);

  await db.insert(users).values({
    id: crypto.randomUUID(),
    email: data.email,
    passwordHash,
    displayName: data.displayName,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });

  return { success: true };
}
