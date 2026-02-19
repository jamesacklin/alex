import { execute, queryOne } from "@/lib/db/rust";

const LIBRARY_VERSION_KEY = "library_version";

type VersionRow = {
  value: string;
};

/**
 * Increment the library version timestamp.
 * Called by the watcher whenever books are added, changed, or deleted.
 */
export async function incrementLibraryVersion(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await execute(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT (key) DO UPDATE
      SET value = excluded.value, updated_at = excluded.updated_at
    `,
    [LIBRARY_VERSION_KEY, String(now), now]
  );
}

/**
 * Get the current library version timestamp.
 * Used by SSE endpoint to detect changes.
 */
export async function getLibraryVersion(): Promise<number> {
  const existing = await queryOne<VersionRow>(
    `
      SELECT value
      FROM settings
      WHERE key = ?1
      LIMIT 1
    `,
    [LIBRARY_VERSION_KEY]
  );

  if (existing?.value) {
    return parseInt(existing.value, 10) || 0;
  }

  // Initialize if missing, but tolerate concurrent initializers.
  const now = Math.floor(Date.now() / 1000);
  await execute(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT (key) DO NOTHING
    `,
    [LIBRARY_VERSION_KEY, String(now), now]
  );

  const persisted = await queryOne<VersionRow>(
    `
      SELECT value
      FROM settings
      WHERE key = ?1
      LIMIT 1
    `,
    [LIBRARY_VERSION_KEY]
  );

  if (!persisted?.value) {
    return now;
  }

  return parseInt(persisted.value, 10) || 0;
}

