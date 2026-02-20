import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db/rust";
import { execute } from "@/lib/db/rust";
import fs from "node:fs/promises";
import path from "node:path";

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

        let user: AuthUser | null = null;
        try {
          user = await findAuthUserByEmail(email);
        } catch (error) {
          console.error("[auth] Failed to query users for credentials login", error);
          return null;
        }

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

type AuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
};

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const ADMIN_EMAIL = "admin@localhost";
const ADMIN_PASSWORD = "admin123";
const ADMIN_ID = "1";

let bootstrapPromise: Promise<void> | null = null;

async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  const row = await queryUserRow(email).catch(async (error) => {
    if (!isMissingUsersTableError(error)) {
      throw error;
    }

    console.warn("[auth] Missing users table detected. Attempting automatic DB bootstrap.");
    await bootstrapAuthDatabase();
    return queryUserRow(email);
  });

  if (!row) return null;

  const normalized = normalizeAuthUserRow(row);
  if (!normalized) {
    console.error("[auth] User row is missing required fields for credentials auth");
  }
  return normalized;
}

function normalizeAuthUserRow(row: Record<string, unknown>): AuthUser | null {
  const id = getString(row, ["id"]);
  const email = getString(row, ["email"]);
  const passwordHash = getString(row, ["password_hash", "passwordHash", "password"]);
  const displayName = getString(row, ["display_name", "displayName", "name"]) ?? email;
  const role = getString(row, ["role"]) ?? "user";

  if (!id || !email || !passwordHash || !displayName) {
    return null;
  }

  return {
    id,
    email,
    passwordHash,
    displayName,
    role,
  };
}

function getString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function isMissingUsersTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such table: users");
}

async function queryUserRow(email: string): Promise<Record<string, unknown> | null> {
  return queryOne<Record<string, unknown>>(
    `
      SELECT *
      FROM users
      WHERE email = ?1
      LIMIT 1
    `,
    [email]
  );
}

async function bootstrapAuthDatabase(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = doBootstrapAuthDatabase().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}

async function doBootstrapAuthDatabase(): Promise<void> {
  const migrationPath = path.resolve(
    process.env.DB_MIGRATION_PATH || "./src/lib/db/migrations/0000_wide_expediter.sql"
  );
  const migrationSql = await fs.readFile(migrationPath, "utf8");
  const statements = migrationSql
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    try {
      await execute(statement);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }
      throw error;
    }
  }

  const usersCount = await queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  if ((usersCount?.count ?? 0) > 0) {
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const now = Math.floor(Date.now() / 1000);

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [ADMIN_ID, ADMIN_EMAIL, passwordHash, "Admin", "admin", now, now]
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("already exists");
}
