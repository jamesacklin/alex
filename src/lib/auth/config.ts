import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

declare module "next-auth" {
  interface User {
    role: string;
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

const nextAuthResult = NextAuth({
  trustHost: true,
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
        const email = String(credentials?.email ?? "");
        const password = String(credentials?.password ?? "");

        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          role: user.role,
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
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.displayName = token.displayName as string;
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuthResult;

// Desktop mode bypass: return a synthetic admin session without requiring login
async function desktopSession() {
  return {
    user: { id: '1', email: 'admin@localhost', displayName: 'Admin', role: 'admin' },
    expires: new Date(Date.now() + 365 * 86400000).toISOString(),
  };
}

// Dynamic auth session that checks ALEX_DESKTOP at runtime
export async function authSession() {
  if (process.env.ALEX_DESKTOP === 'true') {
    return desktopSession();
  }
  return nextAuthResult.auth();
}
