/**
 * @jest-environment node
 *
 * Regressions for the readiness half of F10 (Docker serves requests before
 * successful initialization).
 */
import fs from "fs";
import path from "path";
import { createTestDatabase } from "./helpers/test-db";

const testDb = createTestDatabase("health-api");

import { execute } from "@/lib/db/rust";

beforeAll(async () => {
  await testDb.migrate();
});

afterAll(() => {
  testDb.cleanup();
});

describe("GET /api/health", () => {
  it("reports ok on a fully migrated database", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports degraded, not ok, when the schema is behind", async () => {
    const { EXPECTED_SCHEMA_VERSION, GET } = await import("@/app/api/health/route");

    // Simulate a half-applied upgrade: the ledger exists but is behind.
    await execute("DELETE FROM schema_migrations WHERE version >= ?1", [
      EXPECTED_SCHEMA_VERSION,
    ]);

    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "degraded" });

    await testDb.migrate();
  });

  it("reports unavailable when the database cannot be read", async () => {
    const { GET } = await import("@/app/api/health/route");

    const previous = process.env.DATABASE_PATH;
    // A path that cannot be opened as a database.
    process.env.DATABASE_PATH = path.join(testDb.dir, "no", "such", "dir", "x.db");
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      process.env.DATABASE_PATH = previous;
    }
  });

  it("expects the highest migration this build ships", async () => {
    const { EXPECTED_SCHEMA_VERSION } = await import("@/app/api/health/route");

    const migrationsDir = path.join(process.cwd(), "src", "lib", "db", "migrations");
    const versions = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => Number(name.slice(0, 4)))
      .filter((value) => Number.isInteger(value));

    expect(versions.length).toBeGreaterThan(0);
    expect(EXPECTED_SCHEMA_VERSION).toBe(Math.max(...versions));
  });
});
