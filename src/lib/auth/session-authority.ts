import { queryOne } from "@/lib/db/rust";

/**
 * The authorization boundary (F05, F11).
 *
 * A JWT session is a claim made at login time. On its own it says nothing
 * about whether the account still exists, still holds the role it had, or
 * has had its authority revoked since — the configured lifetime is 30 days.
 * Every protected operation therefore resolves its session through here,
 * which re-reads the account and refuses anything stale.
 */

export interface LiveSession {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
  expires?: string;
}

interface SessionIdentity {
  id: string;
  sessionVersion: number | undefined;
}

/**
 * Extract a concrete identity, or `null`.
 *
 * Auth.js can populate the session slot with an object describing a
 * *configuration error* rather than a session (GHSA-8fpg-xm3f-6cx3). Such
 * an object is truthy, so a `!!session` test treats a misconfigured
 * deployment as authenticated. Requiring a non-empty `user.id` fails closed
 * on that object and on any other partially formed value.
 */
export function concreteSessionIdentity(session: unknown): SessionIdentity | null {
  if (!session || typeof session !== "object") return null;

  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") return null;

  const id = (user as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) return null;

  const rawVersion = (session as { sessionVersion?: unknown }).sessionVersion;
  const sessionVersion = typeof rawVersion === "number" ? rawVersion : undefined;

  return { id, sessionVersion };
}

type AccountRow = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  sessionVersion: number | null;
  disabledAt: number | null;
};

/**
 * Resolve a decoded session against the database, or `null` if it no longer
 * carries authority.
 *
 * Rejected: an auth-error object or any session without a concrete id; an
 * account that has been deleted; an account that has been disabled; a
 * session whose version no longer matches the account's (password reset,
 * role change, deactivation); and a session minted before session
 * versioning existed, which is treated as revoked so that every session
 * issued by a pre-fix build stops working after the upgrade.
 *
 * Role and display name come back from the database rather than the token,
 * so a demotion takes effect at the next protected operation instead of
 * persisting for the life of the JWT.
 */
export async function resolveLiveSession(session: unknown): Promise<LiveSession | null> {
  const identity = concreteSessionIdentity(session);
  if (!identity) return null;

  let account: AccountRow | null;
  try {
    account = await queryOne<AccountRow>(
      `
        SELECT
          id,
          email,
          display_name AS displayName,
          role,
          session_version AS sessionVersion,
          disabled_at AS disabledAt
        FROM users
        WHERE id = ?1
        LIMIT 1
      `,
      [identity.id]
    );
  } catch (error) {
    // Fail closed: an unreadable users table must not grant authority.
    console.error("[auth] Failed to revalidate session against the database", error);
    return null;
  }

  if (!account) return null;
  if (account.disabledAt !== null && account.disabledAt !== undefined) return null;

  const currentVersion = Number(account.sessionVersion ?? 1);
  if (identity.sessionVersion === undefined || identity.sessionVersion !== currentVersion) {
    return null;
  }

  const expires = (session as { expires?: unknown }).expires;

  return {
    ...(typeof expires === "string" ? { expires } : {}),
    user: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
    },
  };
}
