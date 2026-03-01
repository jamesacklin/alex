import NextAuth from "next-auth";
import { authCookies } from "@/lib/auth/cookies";

// Lightweight NextAuth instance for Edge-runtime middleware.
// No providers needed — only decodes the existing JWT using the shared secret.
// The session callback mirrors the one in config.ts so req.auth is shaped the same way.
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
