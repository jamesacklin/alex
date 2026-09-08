/**
 * @jest-environment node
 *
 * Regressions for the authentication and administrative-boundary findings:
 * F01 (startup restores a publicly known administrator credential),
 * F04 (an ordinary web user can invoke the desktop library wipe route),
 * F05 (deleted, demoted or password-reset users retain session authority),
 * F06 (first-run admin creation is a check-then-insert race) and
 * F11 (middleware accepts an auth-error object).
 *
 * Each test asserts the fixed behaviour, so it fails against the code as it
 * stood at 42ad185.
 */
import bcrypt from "bcryptjs";
import { createTestDatabase } from "./helpers/test-db";

const testDb = createTestDatabase("auth-boundaries");

import { execute, queryOne } from "@/lib/db/rust";
import { NON_LOGIN_PASSWORD_HASH } from "@/lib/auth/password";
import { resetLoginThrottle, trackedAccountCount } from "@/lib/auth/throttle";
import {
  DESKTOP_PRINCIPAL_EMAIL,
  DESKTOP_PRINCIPAL_ID,
} from "@/lib/auth/principals";

// Importing the real config pulls in NextAuth's ESM build, which Jest does
// not transform; the acting administrator is supplied directly instead.
const authMock = jest.fn();
jest.mock("@/lib/auth/config", () => ({
  authSession: () => authMock(),
  auth: () => authMock(),
}));

const NOW = 1_700_000_000;

async function insertUser(overrides: Partial<{
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
  sessionVersion: number;
  disabledAt: number | null;
}> = {}) {
  const user = {
    id: "user-1",
    email: "reader@example.com",
    passwordHash: await bcrypt.hash("correct horse battery", 10),
    displayName: "Reader",
    role: "user",
    sessionVersion: 1,
    disabledAt: null,
    ...overrides,
  };

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role,
        session_version, disabled_at, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
    `,
    [
      user.id,
      user.email,
      user.passwordHash,
      user.displayName,
      user.role,
      user.sessionVersion,
      user.disabledAt,
      NOW,
    ]
  );

  return user;
}

beforeAll(async () => {
  await testDb.migrate();
});

beforeEach(async () => {
  await testDb.truncate();
  resetLoginThrottle();
});

afterAll(() => {
  testDb.cleanup();
});

describe("F01 — no publicly known administrator credential", () => {
  it("refuses to log in with the historical default password", async () => {
    const { verifyCredentials } = await import("@/lib/auth/credentials");

    // A database provisioned by the fixed code has no admin@localhost /
    // admin123 pair at all, so the historical default authenticates nothing.
    await expect(verifyCredentials("admin@localhost", "admin123")).resolves.toBeNull();
  });

  it("refuses to log in as the synthetic desktop principal", async () => {
    const { verifyCredentials } = await import("@/lib/auth/credentials");

    // The desktop row must exist for foreign keys to resolve, but it carries
    // a sentinel hash rather than a password.
    await insertUser({
      id: DESKTOP_PRINCIPAL_ID,
      email: DESKTOP_PRINCIPAL_EMAIL,
      passwordHash: NON_LOGIN_PASSWORD_HASH,
      role: "admin",
    });

    await expect(
      verifyCredentials(DESKTOP_PRINCIPAL_EMAIL, "admin123")
    ).resolves.toBeNull();
    await expect(
      verifyCredentials(DESKTOP_PRINCIPAL_EMAIL, NON_LOGIN_PASSWORD_HASH)
    ).resolves.toBeNull();
    await expect(verifyCredentials(DESKTOP_PRINCIPAL_EMAIL, "")).resolves.toBeNull();
  });

  it("does not create an administrator when the login lookup finds nothing", async () => {
    const { verifyCredentials } = await import("@/lib/auth/credentials");

    await expect(verifyCredentials("nobody@example.com", "whatever")).resolves.toBeNull();

    const count = await queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users");
    expect(Number(count?.total)).toBe(0);
  });

  it("refuses to log in to a disabled account with the right password", async () => {
    const { verifyCredentials } = await import("@/lib/auth/credentials");

    await insertUser({ email: "gone@example.com", disabledAt: NOW });

    await expect(
      verifyCredentials("gone@example.com", "correct horse battery")
    ).resolves.toBeNull();
  });

  it("accepts a correct password for a live account", async () => {
    const { verifyCredentials } = await import("@/lib/auth/credentials");

    await insertUser({ email: "live@example.com", role: "admin", sessionVersion: 7 });

    await expect(
      verifyCredentials("live@example.com", "correct horse battery")
    ).resolves.toMatchObject({
      id: "user-1",
      email: "live@example.com",
      role: "admin",
      sessionVersion: 7,
    });
  });
});

describe("F01 — login throttling is bounded and effective", () => {
  it("locks an account out after repeated failures and stays bounded", async () => {
    const {
      checkLoginAttempt,
      recordLoginFailure,
      recordLoginSuccess,
    } = await import("@/lib/auth/throttle");

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(checkLoginAttempt("target@example.com").allowed).toBe(true);
      recordLoginFailure("target@example.com");
    }

    const blocked = checkLoginAttempt("target@example.com");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // Case-insensitive: an attacker cannot reset the budget by changing case.
    expect(checkLoginAttempt("TARGET@EXAMPLE.COM").allowed).toBe(false);

    // A successful login clears the budget.
    recordLoginSuccess("target@example.com");
    expect(checkLoginAttempt("target@example.com").allowed).toBe(true);
  });

  it("evicts old entries instead of growing without bound", async () => {
    const { recordLoginFailure } = await import("@/lib/auth/throttle");

    for (let index = 0; index < 5_000; index++) {
      recordLoginFailure(`spray-${index}@example.com`);
    }

    expect(trackedAccountCount()).toBeLessThanOrEqual(1024);
  });
});

describe("F06 — first-run setup is atomic and owner-authorized", () => {
  async function withSetupToken<T>(token: string, run: () => Promise<T>): Promise<T> {
    const previous = process.env.ALEX_SETUP_TOKEN;
    process.env.ALEX_SETUP_TOKEN = token;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env.ALEX_SETUP_TOKEN;
      else process.env.ALEX_SETUP_TOKEN = previous;
    }
  }

  it("rejects setup without the one-time bootstrap token", async () => {
    const { createAdmin } = await import("@/app/(auth)/setup/actions");

    const result = await withSetupToken("the-real-token", () =>
      createAdmin({
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-long-enough-password",
        setupToken: "guessed-token",
      })
    );

    expect(result).toEqual({ error: "Invalid or expired setup token" });

    const count = await queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users");
    expect(Number(count?.total)).toBe(0);
  });

  it("rejects malformed payloads with a controlled validation error", async () => {
    const { createAdmin } = await import("@/app/(auth)/setup/actions");

    await withSetupToken("the-real-token", async () => {
      // A server action is a public endpoint: its TypeScript signature does
      // not constrain what arrives.
      const cases: unknown[] = [
        undefined,
        null,
        "not-an-object",
        { email: "not-an-email", displayName: "X", password: "longenough1", setupToken: "the-real-token" },
        { email: "owner@example.com", displayName: "", password: "longenough1", setupToken: "the-real-token" },
        { email: "owner@example.com", displayName: "Owner", password: "short", setupToken: "the-real-token" },
        { email: { $ne: null }, displayName: [], password: 12345, setupToken: "the-real-token" },
      ];

      for (const payload of cases) {
        const result = await createAdmin(payload);
        expect(result).toHaveProperty("error");
      }
    });

    const count = await queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users");
    expect(Number(count?.total)).toBe(0);
  });

  it("creates exactly one admin when setup requests race", async () => {
    const { createAdmin } = await import("@/app/(auth)/setup/actions");

    const results = await withSetupToken("the-real-token", () =>
      Promise.all(
        Array.from({ length: 8 }, (_unused, index) =>
          createAdmin({
            email: `owner-${index}@example.com`,
            displayName: `Owner ${index}`,
            password: "a-long-enough-password",
            setupToken: "the-real-token",
          })
        )
      )
    );

    const succeeded = results.filter((result) => "success" in result);
    expect(succeeded).toHaveLength(1);

    const admins = await queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
    );
    expect(Number(admins?.total)).toBe(1);
  });

  it("rejects a second setup attempt once an account exists", async () => {
    const { createAdmin } = await import("@/app/(auth)/setup/actions");
    await insertUser({ email: "first@example.com", role: "admin" });

    const result = await withSetupToken("the-real-token", () =>
      createAdmin({
        email: "second@example.com",
        displayName: "Second",
        password: "a-long-enough-password",
        setupToken: "the-real-token",
      })
    );

    expect(result).toEqual({ error: "Setup already completed" });
  });
});

describe("F05 — revoked authority cannot be replayed", () => {
  it("accepts a session whose version matches the account", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");
    await insertUser({ id: "live-1", email: "live@example.com", sessionVersion: 3 });

    const session = await resolveLiveSession({
      user: { id: "live-1", email: "live@example.com", displayName: "Reader", role: "user" },
      sessionVersion: 3,
      expires: "2030-01-01T00:00:00.000Z",
    });

    expect(session?.user).toMatchObject({ id: "live-1", role: "user" });
  });

  it("rejects a session captured before a password reset", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");
    const { updateUserPassword } = await import("@/app/(dashboard)/admin/users/actions");

    await insertUser({ id: "admin-1", email: "admin@example.com", role: "admin", sessionVersion: 1 });
    await insertUser({ id: "victim-1", email: "victim@example.com", sessionVersion: 1 });

    const capturedSession = {
      user: { id: "victim-1", email: "victim@example.com", displayName: "Reader", role: "user" },
      sessionVersion: 1,
    };
    expect(await resolveLiveSession(capturedSession)).not.toBeNull();

    authMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", displayName: "Admin", role: "admin" },
    });
    expect(await updateUserPassword("victim-1", { password: "a-brand-new-password" })).toEqual({
      success: true,
    });

    expect(await resolveLiveSession(capturedSession)).toBeNull();
  });

  it("rejects a session captured before a demotion", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");

    await insertUser({ id: "acting-admin", email: "acting@example.com", role: "admin" });
    await insertUser({ id: "former-admin", email: "former@example.com", role: "admin", sessionVersion: 1 });

    const capturedAdminSession = {
      user: {
        id: "former-admin",
        email: "former@example.com",
        displayName: "Former",
        role: "admin",
      },
      sessionVersion: 1,
    };
    expect((await resolveLiveSession(capturedAdminSession))?.user.role).toBe("admin");

    authMock.mockResolvedValue({
      user: { id: "acting-admin", email: "acting@example.com", displayName: "A", role: "admin" },
    });
    const { updateUser } = await import("@/app/(dashboard)/admin/users/actions");
    expect(await updateUser("former-admin", { displayName: "Former", role: "user" })).toEqual({
      success: true,
    });

    expect(await resolveLiveSession(capturedAdminSession)).toBeNull();
  });

  it("rejects a session belonging to a deleted account", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");
    await insertUser({ id: "deleted-1", email: "deleted@example.com", sessionVersion: 1 });

    const captured = {
      user: { id: "deleted-1", email: "deleted@example.com", displayName: "D", role: "user" },
      sessionVersion: 1,
    };
    expect(await resolveLiveSession(captured)).not.toBeNull();

    await execute("DELETE FROM users WHERE id = ?1", ["deleted-1"]);

    expect(await resolveLiveSession(captured)).toBeNull();
  });

  it("rejects a session belonging to a disabled account", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");
    await insertUser({ id: "off-1", email: "off@example.com", sessionVersion: 1, disabledAt: NOW });

    expect(
      await resolveLiveSession({
        user: { id: "off-1", email: "off@example.com", displayName: "O", role: "user" },
        sessionVersion: 1,
      })
    ).toBeNull();
  });

  it("revokes a live session the moment an admin disables the account", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");
    const { setUserDisabled } = await import("@/app/(dashboard)/admin/users/actions");

    await insertUser({ id: "acting", email: "acting@example.com", role: "admin" });
    await insertUser({ id: "target", email: "target@example.com", sessionVersion: 1 });

    const captured = {
      user: { id: "target", email: "target@example.com", displayName: "T", role: "user" },
      sessionVersion: 1,
    };
    expect(await resolveLiveSession(captured)).not.toBeNull();

    authMock.mockResolvedValue({
      user: { id: "acting", email: "acting@example.com", displayName: "A", role: "admin" },
    });
    expect(await setUserDisabled("target", true)).toEqual({ success: true });

    expect(await resolveLiveSession(captured)).toBeNull();

    // Re-enabling does not resurrect the old session: the version moved on.
    expect(await setUserDisabled("target", false)).toEqual({ success: true });
    expect(await resolveLiveSession(captured)).toBeNull();
  });

  it("refuses to disable the acting administrator's own account", async () => {
    const { setUserDisabled } = await import("@/app/(dashboard)/admin/users/actions");
    await insertUser({ id: "acting", email: "acting@example.com", role: "admin" });

    authMock.mockResolvedValue({
      user: { id: "acting", email: "acting@example.com", displayName: "A", role: "admin" },
    });
    expect(await setUserDisabled("acting", true)).toEqual({
      error: "Cannot disable your own account",
    });
  });

  it("refuses account deactivation from a non-admin", async () => {
    const { setUserDisabled } = await import("@/app/(dashboard)/admin/users/actions");
    await insertUser({ id: "reader", email: "reader2@example.com", role: "user" });

    authMock.mockResolvedValue({
      user: { id: "reader", email: "reader2@example.com", displayName: "R", role: "user" },
    });
    expect(await setUserDisabled("reader", true)).toEqual({ error: "Forbidden" });
  });

  it("rejects a legacy session that carries no version at all", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");
    await insertUser({ id: "legacy-1", email: "legacy@example.com", sessionVersion: 1 });

    // Tokens issued by the pre-fix build have no session version. Treating
    // them as revoked is the intended effect of the upgrade.
    expect(
      await resolveLiveSession({
        user: { id: "legacy-1", email: "legacy@example.com", displayName: "L", role: "admin" },
      })
    ).toBeNull();
  });
});

describe("F11 — an auth-error object is not an identity", () => {
  it("refuses every non-identity value handed to the session boundary", async () => {
    const { concreteSessionIdentity } = await import("@/lib/auth/session-authority");

    // The shape Auth.js populates on a configuration error is truthy, which
    // is exactly why `!!session` fails open.
    const authErrorObject = {
      type: "AuthError",
      name: "MissingSecret",
      message: "Please define a `secret`",
    };

    for (const value of [
      authErrorObject,
      {},
      { user: null },
      { user: {} },
      { user: { id: "" } },
      { user: { id: 42 } },
      "session",
      0,
      null,
      undefined,
    ]) {
      expect(concreteSessionIdentity(value)).toBeNull();
    }

    expect(concreteSessionIdentity({ user: { id: "u1" }, sessionVersion: 2 })).toEqual({
      id: "u1",
      sessionVersion: 2,
    });
  });

  it("does not authenticate an auth-error object at the DB boundary", async () => {
    const { resolveLiveSession } = await import("@/lib/auth/session-authority");

    expect(
      await resolveLiveSession({ type: "AuthError", name: "MissingSecret" })
    ).toBeNull();
  });
});

describe("destructive routes require the authority they claim to", () => {
  async function seedBooks() {
    await execute(
      `
        INSERT INTO books (
          id, title, file_type, file_path, file_size, file_hash, added_at, updated_at
        )
        VALUES ('book-1', 'Keep Me', 'epub', '/library/keep.epub', 10, 'hash-keep', ?1, ?1)
      `,
      [NOW]
    );
  }

  async function bookCount() {
    const row = await queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM books");
    return Number(row?.total ?? 0);
  }

  it("refuses the admin library wipe for an ordinary reader", async () => {
    await seedBooks();
    authMock.mockResolvedValue({
      user: { id: "reader-1", email: "reader@example.com", displayName: "R", role: "user" },
    });

    const { POST } = await import("@/app/api/admin/library/clear/route");
    const response = await POST();

    expect(response.status).toBe(403);
    expect(await bookCount()).toBe(1);
  });

  it("refuses the admin library wipe for an unauthenticated caller", async () => {
    await seedBooks();
    authMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/library/clear/route");
    const response = await POST();

    expect(response.status).toBe(403);
    expect(await bookCount()).toBe(1);
  });

  it("refuses the admin library wipe for an auth-error object", async () => {
    await seedBooks();
    // Whatever middleware does, the route must not accept this shape.
    authMock.mockResolvedValue({ type: "AuthError", name: "MissingSecret" });

    const { POST } = await import("@/app/api/admin/library/clear/route");
    const response = await POST();

    expect(response.status).toBe(403);
    expect(await bookCount()).toBe(1);
  });

  it("allows the admin library wipe for an administrator", async () => {
    await seedBooks();
    authMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", displayName: "A", role: "admin" },
    });

    const { POST } = await import("@/app/api/admin/library/clear/route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await bookCount()).toBe(0);
  });

  it("refuses user administration for an ordinary reader", async () => {
    await insertUser({ id: "reader-1", email: "reader@example.com", role: "user" });
    await insertUser({ id: "victim", email: "victim@example.com", role: "user" });

    authMock.mockResolvedValue({
      user: { id: "reader-1", email: "reader@example.com", displayName: "R", role: "user" },
    });

    const { createUser, deleteUser, updateUser, updateUserPassword } = await import(
      "@/app/(dashboard)/admin/users/actions"
    );

    expect(
      await createUser({
        email: "new@example.com",
        displayName: "New",
        password: "a-long-enough-password",
        role: "admin",
      })
    ).toEqual({ error: "Forbidden" });
    expect(await deleteUser("victim")).toEqual({ error: "Forbidden" });
    expect(await updateUser("victim", { displayName: "X", role: "admin" })).toEqual({
      error: "Forbidden",
    });
    expect(await updateUserPassword("victim", { password: "a-long-enough-password" })).toEqual({
      error: "Forbidden",
    });

    const { DELETE } = await import("@/app/api/users/[id]/route");
    const response = await DELETE(
      new Request("http://localhost/api/users/victim", { method: "DELETE" }),
      { params: Promise.resolve({ id: "victim" }) }
    );
    expect(response.status).toBe(403);

    expect(await queryOne("SELECT id FROM users WHERE id = 'victim'")).not.toBeNull();
  });
});

describe("F04 — the desktop wipe route is not reachable from the web", () => {
  // `isDesktopMode()` closes over the live `process.env` object, so these
  // tests mutate individual keys rather than replacing the object.
  const desktopKeys = ["ALEX_DESKTOP", "ALEX_DESKTOP_AUTH_TOKEN"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of desktopKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of desktopKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  async function seedOneBook() {
    await execute(
      `
        INSERT INTO books (
          id, title, file_type, file_path, file_size, file_hash, added_at, updated_at
        )
        VALUES ('book-1', 'Keep Me', 'epub', '/library/keep.epub', 10, 'hash-keep', ?1, ?1)
      `,
      [NOW]
    );
  }

  async function bookCount() {
    const row = await queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM books");
    return Number(row?.total ?? 0);
  }

  it("returns 404 in web mode even for a localhost Host header", async () => {
    await seedOneBook();

    const { POST } = await import("@/app/api/electron/clear-books/route");
    const { NextRequest } = await import("next/server");

    const response = await POST(
      new NextRequest("http://localhost:3000/api/electron/clear-books", {
        method: "POST",
        headers: { host: "localhost:3000" },
      })
    );

    expect(response.status).toBe(404);
    expect(await bookCount()).toBe(1);
  });

  it("returns 404 in web mode for a forwarded Host that merely contains localhost", async () => {
    await seedOneBook();

    const { POST } = await import("@/app/api/electron/clear-books/route");
    const { NextRequest } = await import("next/server");

    const response = await POST(
      new NextRequest("http://alex.example.com/api/electron/clear-books", {
        method: "POST",
        headers: { host: "localhost.attacker.example" },
      })
    );

    expect(response.status).toBe(404);
    expect(await bookCount()).toBe(1);
  });

  it("requires the desktop capability token in desktop mode", async () => {
    process.env.ALEX_DESKTOP = "true";
    process.env.ALEX_DESKTOP_AUTH_TOKEN = "desktop-token";
    await seedOneBook();

    const { POST } = await import("@/app/api/electron/clear-books/route");
    const { NextRequest } = await import("next/server");

    const unauthorized = await POST(
      new NextRequest("http://127.0.0.1:3210/api/electron/clear-books", {
        method: "POST",
        headers: { host: "127.0.0.1:3210" },
      })
    );
    expect(unauthorized.status).toBe(401);
    expect(await bookCount()).toBe(1);

    const authorized = await POST(
      new NextRequest("http://127.0.0.1:3210/api/electron/clear-books", {
        method: "POST",
        headers: { host: "127.0.0.1:3210", "x-alex-desktop-auth": "desktop-token" },
      })
    );
    expect(authorized.status).toBe(200);
    expect(await bookCount()).toBe(0);
  });
});
