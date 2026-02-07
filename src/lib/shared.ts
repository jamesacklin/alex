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

/**
 * Retrieves a book from a shared collection
 * @param token - The share token of the collection
 * @param bookId - The ID of the book to retrieve
 * @returns The book if it exists in the shared collection, null otherwise
 */
export async function getSharedBook(token: string, bookId: string) {
  if (!bookId || typeof bookId !== "string") {
    return null;
  }

  // First validate the share token
  const collection = await getSharedCollection(token);
  if (!collection) {
    return null;
  }

  try {
    // Verify the book exists in the collection
    const result = await db
      .select({
        id: books.id,
        title: books.title,
        author: books.author,
        description: books.description,
        fileType: books.fileType,
        filePath: books.filePath,
        fileSize: books.fileSize,
        fileHash: books.fileHash,
        coverPath: books.coverPath,
        pageCount: books.pageCount,
        addedAt: books.addedAt,
        updatedAt: books.updatedAt,
      })
      .from(books)
      .innerJoin(collectionBooks, eq(books.id, collectionBooks.bookId))
      .where(
        and(
          eq(collectionBooks.collectionId, collection.id),
          eq(books.id, bookId)
        )
      )
      .limit(1);

    return result[0] ?? null;
  } catch (error) {
    console.error("Error fetching shared book:", error);
    return null;
  }
}
