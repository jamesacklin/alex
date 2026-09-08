"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { execute } from "@/lib/db/rust";
import { consumeSetupToken, verifySetupToken } from "@/lib/auth/bootstrap";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * Server-side schema for the first-run form.
 *
 * A server action is a public HTTP endpoint: its TypeScript signature says
 * nothing about what actually arrives, so the payload is validated here and
 * not only in the browser form.
 */
const createAdminSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+$/, "Must be a valid email"),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
  setupToken: z.string().min(1),
});

export async function createAdmin(data: unknown) {
  const parsed = createAdminSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Invalid setup details" };
  }

  const { email, displayName, password, setupToken } = parsed.data;

  // Proof that the caller has access to the host, not merely to the URL.
  if (!(await verifySetupToken(setupToken))) {
    return { error: "Invalid or expired setup token" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = Math.floor(Date.now() / 1000);

  // One statement, so the empty-table check and the insert cannot interleave.
  // Two concurrent setup requests both see an empty table under the previous
  // check-then-insert shape; here SQLite evaluates the NOT EXISTS guard and
  // the insert atomically, so exactly one of them changes a row.
  const changes = await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role,
        session_version, created_at, updated_at
      )
      SELECT ?1, ?2, ?3, ?4, 'admin', 1, ?5, ?5
      WHERE NOT EXISTS (SELECT 1 FROM users)
    `,
    [crypto.randomUUID(), email, passwordHash, displayName, now]
  );

  if (changes === 0) {
    return { error: "Setup already completed" };
  }

  // The token is single-use: a second /setup attempt has nothing to present.
  await consumeSetupToken();

  return { success: true };
}
