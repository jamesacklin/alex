import { execute, queryAll } from "../src/lib/db/rust";

async function removeDuplicates() {
  console.log("Finding duplicate books...");

  // Find all books, grouped by fileHash
  const allBooks = await queryAll<{
    id: string;
    title: string;
    fileHash: string;
    addedAt: number;
  }>(
    `
      SELECT
        id,
        title,
        file_hash AS fileHash,
        added_at AS addedAt
      FROM books
    `
  );
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
        await execute("DELETE FROM books WHERE id = ?1", [book.id]);
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
