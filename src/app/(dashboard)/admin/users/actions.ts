"use server";

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";

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

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  if (existing) {
    return { error: "Email already in use" };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const now = Math.floor(Date.now() / 1000);

  await db.insert(users).values({
    id: crypto.randomUUID(),
    email: data.email,
    passwordHash,
    displayName: data.displayName,
    role: data.role,
    createdAt: now,
    updatedAt: now,
  });

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

  await db.delete(users).where(eq(users.id, id));

  return { success: true };
}
