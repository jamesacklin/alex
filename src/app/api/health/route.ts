import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

/**
 * Readiness probe (F10).
 *
 * A listening socket is not the same thing as a usable instance. The
 * container used to background its whole `db:push && db:seed && watcher`
 * AND-list, so Node started immediately and answered requests whether or
 * not the schema had been created — a failed migration did not stop the
 * HTTP server.
 *
 * This endpoint reports on the storage the app actually needs:
 *
 *  - `ok`: the database answers and its schema is at the version this build
 *    expects. Safe to send real traffic.
 *  - `degraded` (503): the database answers but the schema is behind, so a
 *    migration has not completed. Do not send traffic.
 *  - `unavailable` (503): the database cannot be reached at all.
 *
 * Deliberately unauthenticated and free of any account information: it must
 * answer before the first account exists.
 */
export async function GET() {
  let schemaVersion: number | null = null;

  try {
    const row = await queryOne<{ version: number | null }>(
      "SELECT MAX(version) AS version FROM schema_migrations"
    );
    schemaVersion = row?.version ?? null;
  } catch (error) {
    return NextResponse.json(
      {
        status: "unavailable",
        detail: "The database could not be read.",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (schemaVersion === null) {
    return NextResponse.json(
      {
        status: "degraded",
        detail: "No schema migrations have been recorded yet.",
        schemaVersion,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (schemaVersion < EXPECTED_SCHEMA_VERSION) {
    return NextResponse.json(
      {
        status: "degraded",
        detail: `Schema is at version ${schemaVersion}; this build expects ${EXPECTED_SCHEMA_VERSION}.`,
        schemaVersion,
        expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      schemaVersion,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Highest migration version this build ships.
 *
 * Kept in step with `MIGRATIONS` in watcher-rs/src/migrations.rs by
 * src/__tests__/health-api.test.ts, which counts the migration files.
 */
export const EXPECTED_SCHEMA_VERSION = 4;
