import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { isDesktopMode, isDesktopRequestAuthorized } from "@/lib/auth/desktop-auth";
import { authCookies } from "@/lib/auth/cookies";
import { verifyCredentials } from "@/lib/auth/credentials";
import { resolveLiveSession, type LiveSession } from "@/lib/auth/session-authority";
import {
  DESKTOP_PRINCIPAL_DISPLAY_NAME,
  DESKTOP_PRINCIPAL_EMAIL,
  DESKTOP_PRINCIPAL_ID,
} from "@/lib/auth/principals";

declare module "next-auth" {
  interface User {
    role: string;
    sessionVersion?: number;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      displayName: string;
      role: string;
    };
  }
}

export { DESKTOP_PRINCIPAL_EMAIL, DESKTOP_PRINCIPAL_ID } from "@/lib/auth/principals";

const nextAuthResult = NextAuth({
  trustHost: true,
  cookies: authCookies,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const user = await verifyCredentials(
          String(credentials?.email ?? ""),
          String(credentials?.password ?? "")
        );
        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.displayName = user.name ?? "";
        token.sessionVersion = user.sessionVersion ?? 1;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.displayName = token.displayName as string;
      // Carried through so `authSession()` can compare it against the
      // account's current version and reject a revoked session.
      (session as { sessionVersion?: number }).sessionVersion = token.sessionVersion as
        | number
        | undefined;
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuthResult;

// Desktop mode uses a synthetic admin session only when Electron presents a valid session token.
function desktopSession(): LiveSession {
  return {
    user: {
      id: DESKTOP_PRINCIPAL_ID,
      email: DESKTOP_PRINCIPAL_EMAIL,
      displayName: DESKTOP_PRINCIPAL_DISPLAY_NAME,
      role: "admin",
    },
    expires: new Date(Date.now() + 365 * 86400000).toISOString(),
  };
}

async function getRequestHeadersForDesktopAuth(): Promise<Headers | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

/**
 * Resolve the session for a protected operation.
 *
 * Middleware runs on the Edge runtime and cannot reach the database, so it
 * can only make a cheap routing decision. This is where authority is
 * actually established: the decoded session is revalidated against the
 * database on every call, so a deleted, disabled, demoted or
 * password-reset account loses access at its next protected operation
 * rather than when its 30-day JWT expires.
 */
export async function authSession(): Promise<LiveSession | null> {
  if (isDesktopMode()) {
    const requestHeaders = await getRequestHeadersForDesktopAuth();
    if (requestHeaders && isDesktopRequestAuthorized(requestHeaders)) {
      return desktopSession();
    }
  }

  // Fall through to the standard web session (used both in web mode and in
  // desktop mode for requests without the desktop capability header, e.g.
  // relay/browser traffic hitting the same server).
  const session = await nextAuthResult.auth();
  return resolveLiveSession(session);
}
