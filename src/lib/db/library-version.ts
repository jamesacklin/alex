import { db } from "./index";
import { settings } from "./schema";
import { eq } from "drizzle-orm";

const LIBRARY_VERSION_KEY = "library_version";

/**
 * Increment the library version timestamp.
 * Called by the watcher whenever books are added, changed, or deleted.
 */
export async function incrementLibraryVersion(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .insert(settings)
    .values({
      key: LIBRARY_VERSION_KEY,
      value: String(now),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: String(now),
        updatedAt: now,
      },
    });
}

/**
 * Get the current library version timestamp.
 * Used by SSE endpoint to detect changes.
 */
export async function getLibraryVersion(): Promise<number> {
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, LIBRARY_VERSION_KEY))
    .limit(1);

  if (existing.length > 0) {
    return parseInt(existing[0].value, 10);
  }

  // Initialize if missing, but tolerate concurrent initializers.
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(settings)
    .values({
      key: LIBRARY_VERSION_KEY,
      value: String(now),
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: settings.key,
    });

  const persisted = await db
    .select()
    .from(settings)
    .where(eq(settings.key, LIBRARY_VERSION_KEY))
    .limit(1);

  if (persisted.length === 0) {
    return now;
  }

  return parseInt(persisted[0].value, 10);
}
