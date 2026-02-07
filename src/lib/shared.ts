import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { collections, books, collectionBooks } from "./db/schema";

/**
 * Retrieves a collection by its share token
 * @param token - The share token to look up
 * @returns The collection if found and shared, null otherwise
 */
export async function getSharedCollection(token: string) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const result = await db
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.shareToken, token),
          isNotNull(collections.shareToken)
        )
      )
      .limit(1);

    return result[0] ?? null;
  } catch (error) {
    console.error("Error fetching shared collection:", error);
    return null;
  }
}
