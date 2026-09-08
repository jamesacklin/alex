import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db/rust";
import { isLoginCapablePasswordHash } from "@/lib/auth/password";
import {
  checkLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth/throttle";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  sessionVersion: number;
};

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
  sessionVersion: number;
  disabledAt: number | null;
};

/**
 * Verify an email/password pair.
 *
 * Extracted from the NextAuth provider so the decision is directly
 * testable. Every rejection path returns `null`; the caller must not
 * distinguish "no such account" from "wrong password" to the client.
 *
 * Notably absent compared with the previous implementation: there is no
 * schema bootstrap and no implicit account creation here. A login request
 * that finds no `users` table is a deployment that has not run its
 * migrations, not an invitation to create an administrator.
 */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<AuthenticatedUser | null> {
  if (!email || !password) return null;

  const throttle = checkLoginAttempt(email);
  if (!throttle.allowed) {
    console.warn(
      `[auth] Login attempt refused by throttle (${throttle.reason}); retry in ${Math.ceil(
        throttle.retryAfterMs / 1000
      )}s`
    );
    return null;
  }

  let user: UserRow | null;
  try {
    user = await findUserByEmail(email);
  } catch (error) {
    console.error("[auth] Failed to query users for credentials login", error);
    return null;
  }

  if (!user) {
    recordLoginFailure(email);
    return null;
  }

  if (user.disabledAt !== null) {
    console.warn("[auth] Refused login for a disabled account");
    recordLoginFailure(email);
    return null;
  }

  // Accounts that exist only so foreign keys resolve — the synthetic
  // desktop principal — carry a sentinel hash and must never authenticate.
  if (!isLoginCapablePasswordHash(user.passwordHash)) {
    console.warn("[auth] Refused login for an account with no usable password");
    recordLoginFailure(email);
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    recordLoginFailure(email);
    return null;
  }

  recordLoginSuccess(email);

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const row = await queryOne<Record<string, unknown>>(
    `
      SELECT *
      FROM users
      WHERE email = ?1
      LIMIT 1
    `,
    [email]
  );
  if (!row) return null;

  const id = readString(row, ["id"]);
  const storedEmail = readString(row, ["email"]);
  const passwordHash = readString(row, ["password_hash", "passwordHash"]);
  const displayName = readString(row, ["display_name", "displayName"]) ?? storedEmail;
  const role = readString(row, ["role"]) ?? "user";
  const sessionVersion = Number(row.session_version ?? row.sessionVersion ?? 1);
  const rawDisabledAt = row.disabled_at ?? row.disabledAt ?? null;

  if (!id || !storedEmail || !passwordHash || !displayName) {
    console.error("[auth] User row is missing required fields for credentials auth");
    return null;
  }

  return {
    id,
    email: storedEmail,
    passwordHash,
    displayName,
    role,
    sessionVersion: Number.isFinite(sessionVersion) ? sessionVersion : 1,
    disabledAt: typeof rawDisabledAt === "number" ? rawDisabledAt : null,
  };
}

function readString(
  row: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}
