"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";
import { deleteAccount } from "@/lib/db/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * Server actions are public HTTP endpoints; their TypeScript signatures do
 * not constrain what actually arrives. Every payload is validated here.
 */
const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+$/, "Must be a valid email");

const idSchema = z.string().trim().min(1).max(128);

const roleSchema = z.enum(["admin", "user"], {
  message: "Role must be admin or user",
});

const createUserSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1, "Display name is required").max(120),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(1024),
  role: roleSchema,
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required").max(120),
  role: roleSchema,
});

const updatePasswordSchema = z.object({
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(1024),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}

export async function createUser(data: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  const parsed = createUserSchema.safeParse(data);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }
  const { email, displayName, password, role } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 10);
  const now = Math.floor(Date.now() / 1000);

  // The unique index on `email` decides the winner, so two concurrent
  // creates cannot both insert the same address.
  const changes = await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role,
        session_version, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
      ON CONFLICT(email) DO NOTHING
    `,
    [crypto.randomUUID(), email, passwordHash, displayName, role, now]
  );

  if (changes === 0) {
    return { error: "Email already in use" };
  }

  return { success: true };
}

export async function deleteUser(id: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { error: "Invalid user id" };
  }
  const userId = parsedId.data;

  if (session.user.id === userId) {
    return { error: "Cannot delete your own account" };
  }

  // Removes the account together with its reading progress and collections
  // in one transaction; see src/lib/db/accounts.ts for the semantics.
  const result = await deleteAccount(userId);
  if (!result.deleted) {
    return { error: "User not found" };
  }

  return { success: true };
}

export async function updateUser(id: unknown, data: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { error: "Invalid user id" };
  }
  const userId = parsedId.data;

  const parsed = updateUserSchema.safeParse(data);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }
  const { displayName, role } = parsed.data;

  if (session.user.id === userId && role !== "admin") {
    return { error: "Cannot remove your own admin role" };
  }

  const existing = await queryOne<{ id: string; role: string }>(
    `
      SELECT id, role
      FROM users
      WHERE id = ?1
      LIMIT 1
    `,
    [userId]
  );
  if (!existing) {
    return { error: "User not found" };
  }

  // A role change is a change of authority, so bump the session version and
  // strand any session that was issued under the old role. Renaming alone
  // is not, and leaves existing sessions working.
  const revokeSessions = existing.role !== role;

  await execute(
    `
      UPDATE users
      SET display_name = ?1,
          role = ?2,
          session_version = session_version + ?3,
          updated_at = ?4
      WHERE id = ?5
    `,
    [displayName, role, revokeSessions ? 1 : 0, Math.floor(Date.now() / 1000), userId]
  );

  return { success: true };
}

export async function updateUserPassword(id: unknown, data: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { error: "Invalid user id" };
  }
  const userId = parsedId.data;

  const parsed = updatePasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const updatedAt = Math.floor(Date.now() / 1000);

  // A password reset revokes existing authority: bumping session_version
  // invalidates every JWT already issued for this account.
  const changes = await execute(
    `
      UPDATE users
      SET password_hash = ?1,
          session_version = session_version + 1,
          updated_at = ?2
      WHERE id = ?3
    `,
    [passwordHash, updatedAt, userId]
  );

  if (changes === 0) {
    return { error: "User not found" };
  }

  return { success: true };
}

/**
 * Deactivate or reactivate an account without deleting it.
 *
 * A disabled account cannot log in and cannot use a session it already
 * holds, while its reading progress and collections are preserved.
 */
export async function setUserDisabled(id: unknown, disabled: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { error: "Forbidden" };
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { error: "Invalid user id" };
  }
  const userId = parsedId.data;

  if (typeof disabled !== "boolean") {
    return { error: "Invalid request" };
  }

  if (session.user.id === userId && disabled) {
    return { error: "Cannot disable your own account" };
  }

  const now = Math.floor(Date.now() / 1000);
  const changes = await execute(
    `
      UPDATE users
      SET disabled_at = ?1,
          session_version = session_version + 1,
          updated_at = ?2
      WHERE id = ?3
    `,
    [disabled ? now : null, now, userId]
  );

  if (changes === 0) {
    return { error: "User not found" };
  }

  return { success: true };
}
