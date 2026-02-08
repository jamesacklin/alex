import { eq, and } from "drizzle-orm";
import { db } from "./db";
import { collections, books, collectionBooks } from "./db/schema";

/**
 * Retrieves a collection by its share token.
 * Currently treats the token as the collection id.
 */
export async function getSharedCollection(token: string) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const result = await db
      .select()
      .from(collections)
      .where(eq(collections.id, token))
      .limit(1);

    return result[0] ?? null;
  } catch (error) {
    console.error("Error fetching shared collection:", error);
    return null;
  }
}

/**
 * Retrieves a book from a shared collection.
 * Validates the token via the collection lookup.
 */
export async function getSharedBook(token: string, bookId: string) {
  if (!bookId || typeof bookId !== "string") {
    return null;
  }

  const collection = await getSharedCollection(token);
  if (!collection) {
    return null;
  }

  try {
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
          eq(books.id, bookId),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  } catch (error) {
    console.error("Error fetching shared book:", error);
    return null;
  }
}
