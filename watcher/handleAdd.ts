import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { books } from "../src/lib/db/schema";
import { log } from "./log";
import { extractPdfMetadata } from "./extractors/pdf";
import { extractEpubMetadata } from "./extractors/epub";

function computeHash(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export async function handleAdd(filePath: string) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileType = ext === ".pdf" ? "pdf" : "epub";
    const fileSize = fs.statSync(filePath).size;
    const fileHash = computeHash(filePath);

    // Skip duplicates — same content already tracked
    const [existing] = await db
      .select({ title: books.title })
      .from(books)
      .where(eq(books.fileHash, fileHash))
      .limit(1);
    if (existing) {
      log(`[SKIP] Duplicate (matches "${existing.title}"): ${filePath}`);
      return;
    }

    const bookId = randomUUID();

    const metadata =
      fileType === "pdf"
        ? await extractPdfMetadata(filePath, bookId)
        : await extractEpubMetadata(filePath, bookId);

    const now = Math.floor(Date.now() / 1000);

    await db.insert(books).values({
      id: bookId,
      title: metadata.title,
      author: metadata.author ?? null,
      description: metadata.description ?? null,
      fileType,
      filePath,
      fileSize,
      fileHash,
      coverPath: metadata.coverPath ?? null,
      pageCount: metadata.pageCount ?? null,
      addedAt: now,
      updatedAt: now,
    });

    log(`[OK] Added "${metadata.title}" (${fileType})`);
  } catch (error) {
    log(`[ERROR] Failed to process ${filePath}: ${error}`);
  }
}
