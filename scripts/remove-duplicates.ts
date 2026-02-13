import { db } from "../src/lib/db";
import { books } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

async function removeDuplicates() {
  console.log("Finding duplicate books...");

  // Find all books, grouped by fileHash
  const allBooks = await db.select().from(books);
  const byHash = new Map<string, typeof allBooks>();

  for (const book of allBooks) {
    const existing = byHash.get(book.fileHash) || [];
    existing.push(book);
    byHash.set(book.fileHash, existing);
  }

  let duplicatesRemoved = 0;

  for (const bookList of byHash.values()) {
    if (bookList.length > 1) {
      // Sort by addedAt to keep the oldest
      bookList.sort((a, b) => a.addedAt - b.addedAt);
      const toKeep = bookList[0];
      const toRemove = bookList.slice(1);

      console.log(
        `Found ${bookList.length} copies of "${toKeep.title}" (keeping oldest)`
      );

      for (const book of toRemove) {
        await db.delete(books).where(sql`${books.id} = ${book.id}`);
        duplicatesRemoved++;
        console.log(`  Removed duplicate: ${book.id}`);
      }
    }
  }

  console.log(`\nRemoved ${duplicatesRemoved} duplicate book(s).`);
  console.log(`Total unique books: ${byHash.size}`);
}

removeDuplicates()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
