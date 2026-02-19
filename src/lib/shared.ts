import { queryOne } from "@/lib/db/rust";

type SharedCollection = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  shareToken: string | null;
  sharedAt: number | null;
  createdAt: number;
};

type SharedBook = {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  fileType: string;
  filePath: string;
  fileSize: number;
  fileHash: string;
  coverPath: string | null;
  pageCount: number | null;
  addedAt: number;
  updatedAt: number;
};

/**
 * Retrieves a collection by its share token
 * @param token - The share token to look up
 * @returns The collection if found and shared, null otherwise
 */
export async function getSharedCollection(token: string): Promise<SharedCollection | null> {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    return await queryOne<SharedCollection>(
      `
        SELECT
          id,
          user_id AS userId,
          name,
          description,
          share_token AS shareToken,
          shared_at AS sharedAt,
          created_at AS createdAt
        FROM collections
        WHERE share_token = ?1
          AND share_token IS NOT NULL
        LIMIT 1
      `,
      [token]
    );
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
export async function getSharedBook(token: string, bookId: string): Promise<SharedBook | null> {
  if (!bookId || typeof bookId !== "string") {
    return null;
  }

  const collection = await getSharedCollection(token);
  if (!collection) {
    return null;
  }

  try {
    return await queryOne<SharedBook>(
      `
        SELECT
          b.id,
          b.title,
          b.author,
          b.description,
          b.file_type AS fileType,
          b.file_path AS filePath,
          b.file_size AS fileSize,
          b.file_hash AS fileHash,
          b.cover_path AS coverPath,
          b.page_count AS pageCount,
          b.added_at AS addedAt,
          b.updated_at AS updatedAt
        FROM books b
        INNER JOIN collection_books cb ON b.id = cb.book_id
        WHERE cb.collection_id = ?1
          AND b.id = ?2
        LIMIT 1
      `,
      [collection.id, bookId]
    );
  } catch (error) {
    console.error("Error fetching shared book:", error);
    return null;
  }
}

