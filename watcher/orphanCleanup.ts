import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { books } from "../src/lib/db/schema";
import { log } from "./log";

export async function removeOrphanedBooks() {
  try {
    const allBooks = await db
      .select({
        id: books.id,
        title: books.title,
        filePath: books.filePath,
        coverPath: books.coverPath,
      })
      .from(books);

    let removed = 0;
    for (const book of allBooks) {
      if (!fs.existsSync(book.filePath)) {
        if (book.coverPath) {
          try {
            fs.unlinkSync(book.coverPath);
          } catch {
            // Cover already gone
          }
        }
        await db.delete(books).where(eq(books.id, book.id));
        log(`[SCAN] Removed orphan: "${book.title}"`);
        removed++;
      }
    }

    if (removed > 0) {
      log(`[SCAN] Cleaned up ${removed} orphaned entry(ies).`);
    }
  } catch (error) {
    log(`[ERROR] Orphan cleanup failed: ${error}`);
  }
}
