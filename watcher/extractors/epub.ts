import path from "path";
import fs from "fs";
import EPub from "epub2";
import type { BookMetadata } from "../types";

export async function extractEpubMetadata(filePath: string, bookId: string): Promise<BookMetadata> {
  const titleFallback = path.basename(filePath, path.extname(filePath));

  try {
    const epub = await EPub.createAsync(filePath);

    const title = epub.metadata.title?.trim() || titleFallback;
    const author = epub.metadata.creator?.trim() || undefined;
    const description = epub.metadata.description?.trim() || undefined;

    let coverPath: string | undefined;
    if (epub.metadata.cover) {
      try {
        const [coverBuffer] = await epub.getImageAsync(epub.metadata.cover);
        const coversDir = path.resolve(process.env.COVERS_PATH ?? "data/covers");
        fs.mkdirSync(coversDir, { recursive: true });
        coverPath = path.join(coversDir, `${bookId}.jpg`);
        fs.writeFileSync(coverPath, coverBuffer);
      } catch {
        // Cover image missing or unreadable — skip gracefully
        coverPath = undefined;
      }
    }

    return { title, author, description, coverPath };
  } catch {
    return { title: titleFallback };
  }
}
