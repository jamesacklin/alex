import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { books } from "../src/lib/db/schema";
import { log } from "./log";

export async function handleDelete(filePath: string) {
  try {
    const [book] = await db
      .select({ id: books.id, title: books.title, coverPath: books.coverPath })
      .from(books)
      .where(eq(books.filePath, filePath))
      .limit(1);

    if (!book) {
      log(`[WARN] No DB record for deleted file: ${filePath}`);
      return;
    }

    // Remove cover image if one was saved
    if (book.coverPath) {
      try {
        fs.unlinkSync(book.coverPath);
      } catch {
        // Cover already gone — not a failure
      }
    }

    // FK CASCADE on books.id cleans up reading_progress and collection_books
    await db.delete(books).where(eq(books.id, book.id));

    log(`[DELETE] Removed "${book.title}" from library`);
  } catch (error) {
    log(`[ERROR] Failed to handle deletion of ${filePath}: ${error}`);
  }
}
