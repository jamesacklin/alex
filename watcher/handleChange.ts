import { createHash } from "crypto";
import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { books } from "../src/lib/db/schema";
import { log } from "./log";
import { extractPdfMetadata } from "./extractors/pdf";
import { extractEpubMetadata } from "./extractors/epub";
import { incrementLibraryVersion } from "../src/lib/db/library-version";

function computeHash(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export async function handleChange(filePath: string) {
  try {
    const [book] = await db
      .select({
        id: books.id,
        title: books.title,
        fileHash: books.fileHash,
        fileType: books.fileType,
        coverPath: books.coverPath,
      })
      .from(books)
      .where(eq(books.filePath, filePath))
      .limit(1);

    if (!book) {
      log(`[WARN] Change detected but no DB record: ${filePath}`);
      return;
    }

    const newHash = computeHash(filePath);
    if (newHash === book.fileHash) {
      log(`[SKIP] Hash unchanged for "${book.title}"`);
      return;
    }

    const newSize = fs.statSync(filePath).size;

    const metadata =
      book.fileType === "pdf"
        ? await extractPdfMetadata(filePath, book.id)
        : await extractEpubMetadata(filePath, book.id);

    // Old cover exists but new extraction produced none — remove stale cover file
    if (book.coverPath && !metadata.coverPath) {
      try {
        fs.unlinkSync(book.coverPath);
      } catch {
        // Already gone
      }
    }

    const now = Math.floor(Date.now() / 1000);

    await db
      .update(books)
      .set({
        title: metadata.title,
        author: metadata.author ?? null,
        description: metadata.description ?? null,
        fileSize: newSize,
        fileHash: newHash,
        coverPath: metadata.coverPath ?? null,
        pageCount: metadata.pageCount ?? null,
        updatedAt: now,
      })
      .where(eq(books.id, book.id));

    log(`[UPDATE] "${book.title}" → "${metadata.title}" (${book.fileType})`);

    // Notify clients of library update
    await incrementLibraryVersion();
  } catch (error) {
    log(`[ERROR] Failed to process change for ${filePath}: ${error}`);
  }
}
