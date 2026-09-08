import NextAuth from "next-auth";
import { authCookies } from "@/lib/auth/cookies";

// Lightweight NextAuth instance for Edge-runtime middleware.
// No providers needed — only decodes the existing JWT using the shared secret.
// The session callback mirrors the one in config.ts so req.auth is shaped the same way.
//
// Middleware cannot reach the database (the DB bridge spawns a child
// process, which the Edge runtime does not allow), so it cannot check
// whether an account still exists, still holds its role, or has had its
// session revoked.  It is a routing gate only; `authSession()` in
// src/lib/auth/config.ts is the authorization boundary that every
// protected route and server action goes through.
export const { auth } = NextAuth({
  trustHost: true,
  cookies: authCookies,
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.displayName = token.displayName as string;
      return session;
    },
  },
});
